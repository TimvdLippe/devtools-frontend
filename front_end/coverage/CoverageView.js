// Copyright (c) 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

Coverage.CoverageView = class extends UI.VBox {
  constructor() {
    super(true);

    /** @type {?Coverage.CoverageModel} */
    this._model = null;
    /** @type {?Coverage.CoverageDecorationManager} */
    this._decorationManager = null;
    /** @type {?SDK.ResourceTreeModel} */
    this._resourceTreeModel = null;

    this.registerRequiredCSS('coverage/coverageView.css');

    const toolbarContainer = this.contentElement.createChild('div', 'coverage-toolbar-container');
    const toolbar = new UI.Toolbar('coverage-toolbar', toolbarContainer);

    this._toggleRecordAction =
        /** @type {!UI.Action }*/ (UI.actionRegistry.action('coverage.toggle-recording'));
    this._toggleRecordButton = UI.Toolbar.createActionButton(this._toggleRecordAction);
    toolbar.appendToolbarItem(this._toggleRecordButton);

    const mainTarget = SDK.targetManager.mainTarget();
    const mainTargetSupportsRecordOnReload = mainTarget && mainTarget.model(SDK.ResourceTreeModel);
    if (mainTargetSupportsRecordOnReload) {
      const startWithReloadAction =
          /** @type {!UI.Action }*/ (UI.actionRegistry.action('coverage.start-with-reload'));
      this._startWithReloadButton = UI.Toolbar.createActionButton(startWithReloadAction);
      toolbar.appendToolbarItem(this._startWithReloadButton);
      this._toggleRecordButton.setEnabled(false);
      this._toggleRecordButton.setVisible(false);
    }
    this._clearButton = new UI.ToolbarButton(Common.UIString('Clear all'), 'largeicon-clear');
    this._clearButton.addEventListener(UI.ToolbarButton.Events.Click, this._clear.bind(this));
    toolbar.appendToolbarItem(this._clearButton);

    toolbar.appendSeparator();
    const saveButton = new UI.ToolbarButton(Common.UIString('Export...'), 'largeicon-download');
    saveButton.addEventListener(UI.ToolbarButton.Events.Click, () => this._exportReport());
    toolbar.appendToolbarItem(saveButton);

    /** @type {?RegExp} */
    this._textFilterRegExp = null;
    toolbar.appendSeparator();
    this._filterInput = new UI.ToolbarInput(Common.UIString('URL filter'), '', 0.4, 1);
    this._filterInput.setEnabled(false);
    this._filterInput.addEventListener(UI.ToolbarInput.Event.TextChanged, this._onFilterChanged, this);
    toolbar.appendToolbarItem(this._filterInput);

    toolbar.appendSeparator();

    this._typeFilterValue = null;
    this._filterByTypeComboBox =
        new UI.ToolbarComboBox(this._onFilterByTypeChanged.bind(this), ls`Filter coverage by type`);
    const options = [
      {
        label: ls`All`,
        value: '',
      },
      {
        label: ls`CSS`,
        value: Coverage.CoverageType.CSS,
      },
      {
        label: ls`JavaScript`,
        value: Coverage.CoverageType.JavaScript | Coverage.CoverageType.JavaScriptCoarse,
      },
    ];
    for (const option of options) {
      this._filterByTypeComboBox.addOption(this._filterByTypeComboBox.createOption(option.label, option.value));
    }

    this._filterByTypeComboBox.setSelectedIndex(0);
    this._filterByTypeComboBox.setEnabled(false);
    toolbar.appendToolbarItem(this._filterByTypeComboBox);

    toolbar.appendSeparator();
    this._showContentScriptsSetting = Common.settings.createSetting('showContentScripts', false);
    this._showContentScriptsSetting.addChangeListener(this._onFilterChanged, this);
    const contentScriptsCheckbox = new UI.ToolbarSettingCheckbox(
        this._showContentScriptsSetting, Common.UIString('Include extension content scripts'),
        Common.UIString('Content scripts'));
    toolbar.appendToolbarItem(contentScriptsCheckbox);

    this._coverageResultsElement = this.contentElement.createChild('div', 'coverage-results');
    this._landingPage = this._buildLandingPage();
    this._listView = new Coverage.CoverageListView(this._isVisible.bind(this, false));

    this._statusToolbarElement = this.contentElement.createChild('div', 'coverage-toolbar-summary');
    this._statusMessageElement = this._statusToolbarElement.createChild('div', 'coverage-message');
    this._landingPage.show(this._coverageResultsElement);
  }

  /**
   * @return {!UI.VBox}
   */
  _buildLandingPage() {
    const widget = new UI.VBox();
    let message;
    if (this._startWithReloadButton) {
      const reloadButton = UI.createInlineButton(UI.Toolbar.createActionButtonForId('coverage.start-with-reload'));
      message =
          UI.formatLocalized('Click the reload button %s to reload and start capturing coverage.', [reloadButton]);
    } else {
      const recordButton = UI.createInlineButton(UI.Toolbar.createActionButton(this._toggleRecordAction));
      message = UI.formatLocalized('Click the record button %s to start capturing coverage.', [recordButton]);
    }
    message.classList.add('message');
    widget.contentElement.appendChild(message);
    widget.element.classList.add('landing-page');
    return widget;
  }

  _clear() {
    if (this._model) {
      this._model.reset();
    }
    this._reset();
  }

  _reset() {
    if (this._decorationManager) {
      this._decorationManager.dispose();
      this._decorationManager = null;
    }
    this._listView.reset();
    this._listView.detach();
    this._landingPage.show(this._coverageResultsElement);
    this._statusMessageElement.textContent = '';
    this._filterInput.setEnabled(false);
    this._filterByTypeComboBox.setEnabled(false);
  }

  _toggleRecording() {
    const enable = !this._toggleRecordAction.toggled();

    if (enable) {
      this._startRecording(false);
    } else {
      this.stopRecording();
    }
  }

  async ensureRecordingStarted() {
    const enable = !this._toggleRecordAction.toggled();

    if (enable) {
      await this._startRecording(false);
    }
  }

  /**
   * @param {boolean} reload
   */
  async _startRecording(reload) {
    this._reset();
    const mainTarget = SDK.targetManager.mainTarget();
    if (!mainTarget) {
      return;
    }

    if (!this._model || reload) {
      this._model = mainTarget.model(Coverage.CoverageModel);
    }
    Host.userMetrics.actionTaken(Host.UserMetrics.Action.CoverageStarted);
    const success = await this._model.start();
    if (!success) {
      return;
    }
    this._model.addEventListener(Coverage.CoverageModel.Events.CoverageUpdated, this._onCoverageDataReceived, this);
    this._resourceTreeModel = /** @type {?SDK.ResourceTreeModel} */ (mainTarget.model(SDK.ResourceTreeModel));
    if (this._resourceTreeModel) {
      this._resourceTreeModel.addEventListener(
          SDK.ResourceTreeModel.Events.MainFrameNavigated, this._onMainFrameNavigated, this);
    }
    this._decorationManager =
        new Coverage.CoverageDecorationManager(/** @type {!Coverage.CoverageModel} */ (this._model));
    this._toggleRecordAction.setToggled(true);
    this._clearButton.setEnabled(false);
    if (this._startWithReloadButton) {
      this._startWithReloadButton.setEnabled(false);
      this._startWithReloadButton.setVisible(false);
      this._toggleRecordButton.setEnabled(true);
      this._toggleRecordButton.setVisible(true);
    }
    this._filterInput.setEnabled(true);
    this._filterByTypeComboBox.setEnabled(true);
    if (this._landingPage.isShowing()) {
      this._landingPage.detach();
    }
    this._listView.show(this._coverageResultsElement);
    if (reload && this._resourceTreeModel) {
      this._resourceTreeModel.reloadPage();
    } else {
      this._model.startPolling();
    }
  }

  _onCoverageDataReceived(event) {
    this._updateViews(event.data);
  }

  async stopRecording() {
    if (this._resourceTreeModel) {
      this._resourceTreeModel.removeEventListener(
          SDK.ResourceTreeModel.Events.MainFrameNavigated, this._onMainFrameNavigated, this);
      this._resourceTreeModel = null;
    }
    // Stopping the model triggers one last poll to get the final data.
    await this._model.stop();
    this._model.removeEventListener(Coverage.CoverageModel.Events.CoverageUpdated, this._onCoverageDataReceived, this);
    this._toggleRecordAction.setToggled(false);
    if (this._startWithReloadButton) {
      this._startWithReloadButton.setEnabled(true);
      this._startWithReloadButton.setVisible(true);
      this._toggleRecordButton.setEnabled(false);
      this._toggleRecordButton.setVisible(false);
    }
    this._clearButton.setEnabled(true);
  }

  _onMainFrameNavigated() {
    this._model.reset();
    this._decorationManager.reset();
    this._listView.reset();
    this._model.startPolling();
  }

  /**
   * @param {!Array<!Coverage.CoverageInfo>} updatedEntries
   */
  _updateViews(updatedEntries) {
    this._updateStats();
    this._listView.update(this._model.entries());
    this._decorationManager.update(updatedEntries);
  }

  _updateStats() {
    let total = 0;
    let unused = 0;
    for (const info of this._model.entries()) {
      if (!this._isVisible(true, info)) {
        continue;
      }
      total += info.size();
      unused += info.unusedSize();
    }

    const used = total - unused;
    const percentUsed = total ? Math.round(100 * used / total) : 0;
    this._statusMessageElement.textContent =
        ls`${Number.bytesToString(used)} of ${Number.bytesToString(total)} (${percentUsed}%) used so far.
        ${Number.bytesToString(unused)} unused.`;
  }

  _onFilterChanged() {
    if (!this._listView) {
      return;
    }
    const text = this._filterInput.value();
    this._textFilterRegExp = text ? createPlainTextSearchRegex(text, 'i') : null;
    this._listView.updateFilterAndHighlight(this._textFilterRegExp);
    this._updateStats();
  }

  _onFilterByTypeChanged() {
    if (!this._listView) {
      return;
    }

    Host.userMetrics.actionTaken(Host.UserMetrics.Action.CoverageReportFiltered);

    const type = this._filterByTypeComboBox.selectedOption().value;
    this._typeFilterValue = parseInt(type, 10) || null;
    this._listView.updateFilterAndHighlight(this._textFilterRegExp);
    this._updateStats();
  }

  /**
   * @param {boolean} ignoreTextFilter
   * @param {!Coverage.URLCoverageInfo} coverageInfo
   * @return {boolean}
   */
  _isVisible(ignoreTextFilter, coverageInfo) {
    const url = coverageInfo.url();
    if (url.startsWith(Coverage.CoverageView._extensionBindingsURLPrefix)) {
      return false;
    }
    if (coverageInfo.isContentScript() && !this._showContentScriptsSetting.get()) {
      return false;
    }
    if (this._typeFilterValue && !(coverageInfo.type() & this._typeFilterValue)) {
      return false;
    }

    return ignoreTextFilter || !this._textFilterRegExp || this._textFilterRegExp.test(url);
  }

  async _exportReport() {
    const fos = new Bindings.FileOutputStream();
    const fileName = `Coverage-${new Date().toISO8601Compact()}.json`;
    const accepted = await fos.open(fileName);
    if (!accepted) {
      return;
    }
    this._model.exportReport(fos);
  }

  selectCoverageItemByUrl(url) {
    this._listView.selectByUrl(url);
  }
};

Coverage.CoverageView._extensionBindingsURLPrefix = 'extensions::';

/**
 * @implements {UI.ActionDelegate}
 */
Coverage.CoverageView.ActionDelegate = class {
  /**
   * @override
   * @param {!UI.Context} context
   * @param {string} actionId
   * @return {boolean}
   */
  handleAction(context, actionId) {
    const coverageViewId = 'coverage';
    UI.viewManager.showView(coverageViewId)
        .then(() => UI.viewManager.view(coverageViewId).widget())
        .then(widget => this._innerHandleAction(/** @type !Coverage.CoverageView} */ (widget), actionId));

    return true;
  }

  /**
   * @param {!Coverage.CoverageView} coverageView
   * @param {string} actionId
   */
  _innerHandleAction(coverageView, actionId) {
    switch (actionId) {
      case 'coverage.toggle-recording':
        coverageView._toggleRecording();
        break;
      case 'coverage.start-with-reload':
        coverageView._startRecording(true);
        break;
      default:
        console.assert(false, `Unknown action: ${actionId}`);
    }
  }
};

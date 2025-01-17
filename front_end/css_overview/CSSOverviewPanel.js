// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @unrestricted
 */
CssOverview.CSSOverviewPanel = class extends UI.Panel {
  constructor() {
    super('css_overview');
    this.registerRequiredCSS('css_overview/cssOverview.css');
    this.element.classList.add('css-overview-panel');

    const [model] = SDK.targetManager.models(CssOverview.CSSOverviewModel);
    this._model = model;

    this._controller = new CssOverview.OverviewController();
    this._startView = new CssOverview.CSSOverviewStartView(this._controller);
    this._processingView = new CssOverview.CSSOverviewProcessingView(this._controller);
    this._completedView = new CssOverview.CSSOverviewCompletedView(this._controller, model.target());

    this._controller.addEventListener(CssOverview.Events.RequestOverviewStart, this._startOverview, this);
    this._controller.addEventListener(CssOverview.Events.RequestOverviewCancel, this._cancelOverview, this);
    this._controller.addEventListener(CssOverview.Events.OverviewCompleted, this._overviewCompleted, this);
    this._controller.addEventListener(CssOverview.Events.Reset, this._reset, this);
    this._controller.addEventListener(CssOverview.Events.RequestNodeHighlight, this._requestNodeHighlight, this);

    this._reset();
  }

  _reset() {
    this._backgroundColors = new Map();
    this._textColors = new Map();
    this._fillColors = new Map();
    this._borderColors = new Map();
    this._fontSizes = new Map();
    this._fontWeights = new Map();
    this._mediaQueries = [];
    this._elementCount = 0;
    this._cancelled = false;
    this._globalStyleStats = {
      styleRules: 0,
      inlineStyles: 0,
      externalSheets: 0,
      stats: {
        // Simple.
        type: 0,
        class: 0,
        id: 0,
        universal: 0,
        attribute: 0,

        // Non-simple.
        nonSimple: 0
      }
    };
    this._renderInitialView();
  }

  _requestNodeHighlight(evt) {
    this._model.highlightNode(evt.data);
  }

  _renderInitialView() {
    this._processingView.hideWidget();
    this._completedView.hideWidget();

    this._startView.show(this.contentElement);
  }

  _renderOverviewStartedView() {
    this._startView.hideWidget();
    this._completedView.hideWidget();

    this._processingView.show(this.contentElement);
  }

  _renderOverviewCompletedView() {
    this._startView.hideWidget();
    this._processingView.hideWidget();

    this._completedView.show(this.contentElement);
    this._completedView.setOverviewData({
      backgroundColors: this._backgroundColors,
      textColors: this._textColors,
      fillColors: this._fillColors,
      borderColors: this._borderColors,
      globalStyleStats: this._globalStyleStats,
      fontSizes: this._fontSizes,
      fontWeights: this._fontWeights,
      elementCount: this._elementCount,
      mediaQueries: this._mediaQueries
    });
  }

  async _startOverview() {
    this._renderOverviewStartedView();

    const [nodes, globalStyleStats, {backgroundColors, textColors, fillColors, borderColors, fontSizes, fontWeights}, mediaQueries] =
        await Promise.all([
          this._model.getFlattenedDocument(), this._model.getGlobalStylesheetStats(), this._model.getNodeStyleStats(),
          this._model.getMediaQueries()
        ]);

    if (nodes) {
      this._elementCount = nodes.length;
    }

    if (globalStyleStats) {
      this._globalStyleStats = globalStyleStats;
    }

    if (mediaQueries) {
      this._mediaQueries = mediaQueries;
    }

    if (backgroundColors) {
      this._backgroundColors = backgroundColors;
    }

    if (textColors) {
      this._textColors = textColors;
    }

    if (fillColors) {
      this._fillColors = fillColors;
    }

    if (borderColors) {
      this._borderColors = borderColors;
    }

    if (fontSizes) {
      this._fontSizes = fontSizes;
    }

    if (fontWeights) {
      this._fontWeights = fontWeights;
    }

    this._controller.dispatchEventToListeners(CssOverview.Events.OverviewCompleted);
  }

  _getStyleValue(styles, name) {
    const item = styles.filter(style => style.name === name);
    if (!item.length) {
      return;
    }

    return item[0].value;
  }

  _cancelOverview() {
    this._cancelled = true;
  }

  _overviewCompleted() {
    this._renderOverviewCompletedView();
  }
};

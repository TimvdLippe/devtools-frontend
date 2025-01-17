// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @unrestricted
 */
CssOverview.CSSOverviewModel = class extends SDK.SDKModel {
  /**
   * @param {!SDK.Target} target
   */
  constructor(target) {
    super(target);

    this._runtimeAgent = target.runtimeAgent();
    this._cssAgent = target.cssAgent();
    this._domAgent = target.domAgent();
    this._domSnapshotAgent = target.domsnapshotAgent();
    this._overlayAgent = target.overlayAgent();
  }

  getFlattenedDocument() {
    return this._domAgent.getFlattenedDocument(-1, true);
  }

  highlightNode(node) {
    const highlightConfig = {contentColor: Common.Color.PageHighlight.Content.toProtocolRGBA(), showInfo: true};

    this._overlayAgent.invoke_hideHighlight({});
    this._overlayAgent.invoke_highlightNode({backendNodeId: node, highlightConfig});
  }

  async getNodeStyleStats() {
    const backgroundColors = new Map();
    const textColors = new Map();
    const fillColors = new Map();
    const borderColors = new Map();
    const fontSizes = new Map();
    const fontWeights = new Map();
    const snapshotConfig = {
      computedStyles: [
        'background-color', 'color', 'fill', 'border-top-width', 'border-top-color', 'border-bottom-width',
        'border-bottom-color', 'border-left-width', 'border-left-color', 'border-right-width', 'border-right-color',
        'font-size', 'font-weight'
      ]
    };

    const storeColor = (id, nodeId, target) => {
      if (id === -1) {
        return;
      }

      // Parse the color, discard transparent ones.
      const colorText = strings[id];
      const color = Common.Color.parse(colorText);
      if (color.rgba()[3] === 0) {
        return;
      }

      // Format the color and use as the key.
      const colorFormatted =
          color.hasAlpha() ? color.asString(Common.Color.Format.HEXA) : color.asString(Common.Color.Format.HEX);

      // Get the existing set of nodes with the color, or create a new set.
      const colorValues = target.get(colorFormatted) || new Set();
      colorValues.add(nodeId);

      // Store.
      target.set(colorFormatted, colorValues);
    };

    const isSVGNode = nodeName => {
      const validNodes =
          ['altGlyph', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect', 'text', 'textPath', 'tref', 'tspan'];
      return validNodes.indexOf(nodeName) !== -1;
    };

    const {documents, strings} = await this._domSnapshotAgent.invoke_captureSnapshot(snapshotConfig);
    for (const {nodes, layout} of documents) {
      for (let idx = 0; idx < layout.styles.length; idx++) {
        const styles = layout.styles[idx];
        const nodeIdx = layout.nodeIndex[idx];
        const nodeId = nodes.backendNodeId[nodeIdx];
        const nodeName = nodes.nodeName[nodeIdx];

        const [backgroundColorIdx, textColorIdx, fillIdx, borderTopWidthIdx, borderTopColorIdx, borderBottomWidthIdx, borderBottomColorIdx, borderLeftWidthIdx, borderLeftColorIdx, borderRightWidthIdx, borderRightColorIdx, fontSizeIdx, fontWeightIdx] =
            styles;

        storeColor(backgroundColorIdx, nodeId, backgroundColors);
        storeColor(textColorIdx, nodeId, textColors);

        if (isSVGNode(strings[nodeName])) {
          storeColor(fillIdx, nodeId, fillColors);
        }

        if (strings[borderTopWidthIdx] !== '0px') {
          storeColor(borderTopColorIdx, nodeId, borderColors);
        }

        if (strings[borderBottomWidthIdx] !== '0px') {
          storeColor(borderBottomColorIdx, nodeId, borderColors);
        }

        if (strings[borderLeftWidthIdx] !== '0px') {
          storeColor(borderLeftColorIdx, nodeId, borderColors);
        }

        if (strings[borderRightWidthIdx] !== '0px') {
          storeColor(borderRightColorIdx, nodeId, borderColors);
        }

        if (fontSizeIdx !== -1) {
          const fontSize = strings[fontSizeIdx];
          const fontSizeInstances = (fontSizes.get(fontSize) || 0) + 1;
          fontSizes.set(fontSize, fontSizeInstances);
        }

        if (fontWeightIdx !== -1) {
          const fontWeight = strings[fontWeightIdx];
          const fontWeightInstances = (fontWeights.get(fontWeight) || 0) + 1;
          fontWeights.set(fontWeight, fontWeightInstances);
        }
      }
    }

    return {backgroundColors, textColors, fillColors, borderColors, fontSizes, fontWeights};
  }

  getComputedStyleForNode(nodeId) {
    return this._cssAgent.getComputedStyleForNode(nodeId);
  }

  async getMediaQueries() {
    // Ignore media queries applied to stylesheets; instead only use declared media rules.
    const queries = await this._cssAgent.getMediaQueries();
    return queries.filter(query => query.source !== 'linkedSheet');
  }

  async getGlobalStylesheetStats() {
    // There are no ways to pull CSSOM values directly today, due to its unserializable format,
    // so instead we execute some JS within the page that extracts the relevant data and send that instead.
    const expression = `(function() {
      let styleRules = 0;
      let inlineStyles = 0;
      let externalSheets = 0;
      const stats = {
        // Simple.
        type: new Set(),
        class: new Set(),
        id: new Set(),
        universal: new Set(),
        attribute: new Set(),

        // Non-simple.
        nonSimple: new Set()
      };

      for (const styleSheet of document.styleSheets) {
        if (styleSheet.href) {
          externalSheets++;
        } else {
          inlineStyles++;
        }

        // Attempting to grab rules can trigger a DOMException.
        // Try it and if it fails skip to the next stylesheet.
        let rules;
        try {
          rules = styleSheet.rules;
        } catch (err) {
          continue;
        }

        for (const rule of rules) {
          if ('selectorText' in rule) {
            styleRules++;

            // Each group that was used.
            for (const selectorGroup of rule.selectorText.split(',')) {
              // Each selector in the group.
              for (const selector of selectorGroup.split(\/[\\t\\n\\f\\r ]+\/g)) {
                if (selector.startsWith('.')) {
                  // Class.
                  stats.class.add(selector);
                } else if (selector.startsWith('#')) {
                  // Id.
                  stats.id.add(selector);
                } else if (selector.startsWith('*')) {
                  // Universal.
                  stats.universal.add(selector);
                } else if (selector.startsWith('[')) {
                  // Attribute.
                  stats.attribute.add(selector);
                } else {
                  // Type or non-simple selector.
                  const specialChars = \/[#\.:\\[\\]|\\+>~]\/;
                  if (specialChars.test(selector)) {
                    stats.nonSimple.add(selector);
                  } else {
                    stats.type.add(selector);
                  }
                }
              }
            }
          }
        }
      }

      return {
        styleRules,
        inlineStyles,
        externalSheets,
        stats: {
          // Simple.
          type: stats.type.size,
          class: stats.class.size,
          id: stats.id.size,
          universal: stats.universal.size,
          attribute: stats.attribute.size,

          // Non-simple.
          nonSimple: stats.nonSimple.size
        }
      }
    })()`;
    const {result} = await this._runtimeAgent.invoke_evaluate({expression, returnByValue: true});

    // TODO(paullewis): Handle errors properly.
    if (result.type !== 'object') {
      return;
    }

    return result.value;
  }
};

SDK.SDKModel.register(CssOverview.CSSOverviewModel, SDK.Target.Capability.DOM, false);

/**
 * DevTools Entry Point
 *
 * Creates the DevTools panel and initializes the extension.
 */

console.log('[Aether DevTools] DevTools script loaded');

// Create the Aether panel
chrome.devtools.panels.create(
  'Aether',
  'public/icon48.png',
  'panel.html',
  (panel) => {
    console.log('[Aether DevTools] Panel created');

    let panelWindow = null;
    let port = null;

    panel.onShown.addListener((window) => {
      console.log('[Aether DevTools] Panel shown');
      panelWindow = window;

      // Create connection to background script
      if (!port) {
        port = chrome.runtime.connect({
          name: `devtools-${chrome.devtools.inspectedWindow.tabId}`
        });

        // Forward messages from background to panel
        port.onMessage.addListener((message) => {
          if (panelWindow && panelWindow.handleMessage) {
            panelWindow.handleMessage(message);
          }
        });

        // Send initial request for state
        port.postMessage({
          type: 'panel-ready',
          timestamp: Date.now()
        });
      }

      // Expose port to panel window
      if (panelWindow) {
        panelWindow.devToolsPort = port;
      }
    });

    panel.onHidden.addListener(() => {
      console.log('[Aether DevTools] Panel hidden');
      panelWindow = null;
    });
  }
);

console.log('[Aether DevTools] DevTools initialized');

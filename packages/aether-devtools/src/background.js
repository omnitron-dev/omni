/**
 * Background Script - Service worker for Chrome extension
 *
 * Manages communication between content scripts, DevTools panel, and the app.
 */

// Track connections from DevTools panels
const connections = new Map();

// Track port connections from content scripts
const contentPorts = new Map();

/**
 * Handle DevTools panel connections
 */
chrome.runtime.onConnect.addListener((port) => {
  // DevTools panel connection
  if (port.name.startsWith('devtools-')) {
    const tabId = parseInt(port.name.split('-')[1]);
    connections.set(tabId, port);

    console.log('[Aether DevTools] Panel connected for tab', tabId);

    // Handle messages from DevTools panel
    port.onMessage.addListener((message) => {
      handlePanelMessage(tabId, message);
    });

    // Cleanup on disconnect
    port.onDisconnect.addListener(() => {
      connections.delete(tabId);
      console.log('[Aether DevTools] Panel disconnected for tab', tabId);
    });

    // Notify content script that panel is ready
    const contentPort = contentPorts.get(tabId);
    if (contentPort) {
      contentPort.postMessage({ type: 'panel-ready' });
    }
  }
  // Content script connection
  else if (port.name.startsWith('content-')) {
    const tabId = parseInt(port.name.split('-')[1]);
    contentPorts.set(tabId, port);

    console.log('[Aether DevTools] Content script connected for tab', tabId);

    // Handle messages from content script
    port.onMessage.addListener((message) => {
      handleContentMessage(tabId, message);
    });

    // Cleanup on disconnect
    port.onDisconnect.addListener(() => {
      contentPorts.delete(tabId);
      console.log('[Aether DevTools] Content script disconnected for tab', tabId);
    });
  }
});

/**
 * Handle messages from DevTools panel
 */
function handlePanelMessage(tabId, message) {
  console.log('[Aether DevTools] Panel message:', message);

  // Forward to content script
  const contentPort = contentPorts.get(tabId);
  if (contentPort) {
    contentPort.postMessage(message);
  }
}

/**
 * Handle messages from content script
 */
function handleContentMessage(tabId, message) {
  console.log('[Aether DevTools] Content message:', message);

  // Forward to DevTools panel
  const panelPort = connections.get(tabId);
  if (panelPort) {
    panelPort.postMessage(message);
  }
}

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Aether DevTools] Extension installed');
});

/**
 * Keep service worker alive
 */
setInterval(() => {
  console.log('[Aether DevTools] Service worker heartbeat');
}, 20000);

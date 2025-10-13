/**
 * Content Script - Injected into every page
 *
 * Acts as a bridge between the page's Aether app and the DevTools panel.
 */

// Check if Aether DevTools is available in the page
let aetherDevTools = null;
let connected = false;

// Create port to background script
const port = chrome.runtime.connect({ name: `content-${chrome.devtools?.inspectedWindow?.tabId || 'unknown'}` });

/**
 * Initialize connection
 */
function initialize() {
  console.log('[Aether DevTools] Content script initializing...');

  // Set marker for bridge to detect
  window.__AETHER_DEVTOOLS_EXTENSION__ = true;

  // Check for Aether DevTools in page
  checkForAether();

  // Listen for messages from page
  window.addEventListener('message', handlePageMessage);

  // Listen for messages from background
  port.onMessage.addListener(handleBackgroundMessage);

  // Send handshake to page
  sendToPage({
    source: '__AETHER_DEVTOOLS_HANDSHAKE__',
    type: 'extension-ready',
    timestamp: Date.now()
  });

  console.log('[Aether DevTools] Content script initialized');
}

/**
 * Check if Aether is present in the page
 */
function checkForAether() {
  aetherDevTools = window.__AETHER_DEVTOOLS__;

  if (aetherDevTools) {
    console.log('[Aether DevTools] Aether found in page');
    connected = true;

    // Notify background that Aether is available
    port.postMessage({
      type: 'aether-detected',
      timestamp: Date.now()
    });
  } else {
    // Retry after a delay
    setTimeout(checkForAether, 1000);
  }
}

/**
 * Handle messages from page
 */
function handlePageMessage(event) {
  // Only accept messages from same origin
  if (event.source !== window) return;

  const data = event.data;
  if (!data || !data.source) return;

  // Handle handshake
  if (data.source === '__AETHER_DEVTOOLS_HANDSHAKE__') {
    if (data.type === 'app-ready') {
      console.log('[Aether DevTools] App handshake received');
      checkForAether();

      // Send handshake response
      sendToPage({
        source: '__AETHER_DEVTOOLS_HANDSHAKE__',
        type: 'extension-ready',
        timestamp: Date.now()
      });
    }
    return;
  }

  // Handle DevTools messages
  if (data.source === '__AETHER_DEVTOOLS__') {
    console.log('[Aether DevTools] Message from page:', data.message);

    // Forward to background (which forwards to panel)
    port.postMessage({
      type: 'from-page',
      message: data.message,
      timestamp: Date.now()
    });
  }
}

/**
 * Handle messages from background script (from panel)
 */
function handleBackgroundMessage(message) {
  console.log('[Aether DevTools] Message from background:', message);

  if (message.type === 'panel-ready') {
    console.log('[Aether DevTools] Panel is ready');

    // Request initial state from app
    sendToPage({
      source: '__AETHER_DEVTOOLS__',
      message: {
        type: 'init',
        timestamp: Date.now()
      }
    });
  } else {
    // Forward to page
    sendToPage({
      source: '__AETHER_DEVTOOLS__',
      message
    });
  }
}

/**
 * Send message to page
 */
function sendToPage(data) {
  window.postMessage(data, '*');
}

/**
 * Inject hook script (optional - for deeper integration)
 */
function injectHookScript() {
  const script = document.createElement('script');
  script.textContent = `
    // Hook into Aether if available
    if (window.__AETHER_DEVTOOLS__) {
      console.log('[Aether DevTools] Hook injected');
    }
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Inject hook script
injectHookScript();

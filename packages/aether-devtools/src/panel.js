/**
 * DevTools Panel UI
 *
 * Main UI for the Aether DevTools panel.
 */

console.log('[Aether DevTools] Panel loaded');

// State
let currentState = null;
let selectedNode = null;
let activeTab = 'inspector';
let isRecording = false;
let isProfiling = false;

// Elements
const treeView = document.getElementById('tree-view');
const mainContent = document.getElementById('main-content');
const refreshBtn = document.getElementById('refresh-btn');
const clearBtn = document.getElementById('clear-btn');
const recordBtn = document.getElementById('record-btn');
const profileBtn = document.getElementById('profile-btn');

/**
 * Initialize panel
 */
function initialize() {
  console.log('[Aether DevTools] Panel initializing...');

  // Setup event listeners
  refreshBtn.addEventListener('click', handleRefresh);
  clearBtn.addEventListener('click', handleClear);
  recordBtn.addEventListener('click', handleRecord);
  profileBtn.addEventListener('click', handleProfile);

  // Setup tab switching
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      handleTabSwitch(tab.dataset.tab);
    });
  });

  // Request initial state
  requestState();

  console.log('[Aether DevTools] Panel initialized');
}

/**
 * Handle messages from background script
 */
window.handleMessage = function (message) {
  console.log('[Aether DevTools] Panel received message:', message);

  if (message.type === 'from-page') {
    handleStateUpdate(message.message);
  } else if (message.type === 'state-update') {
    handleStateUpdate(message);
  }
};

/**
 * Request state from app
 */
function requestState() {
  if (window.devToolsPort) {
    window.devToolsPort.postMessage({
      type: 'request-state',
      timestamp: Date.now(),
    });
  }
}

/**
 * Handle state update
 */
function handleStateUpdate(message) {
  console.log('[Aether DevTools] State update:', message);

  if (message.type === 'state-update') {
    currentState = message.payload;
    renderTree();
  } else if (message.type === 'init') {
    // Initial state received
    requestState();
  }
}

/**
 * Render tree view
 */
function renderTree() {
  if (!currentState) {
    treeView.innerHTML = '<div class="status">No Aether app detected</div>';
    return;
  }

  treeView.innerHTML = '';

  // Render based on active tab
  switch (activeTab) {
    case 'inspector':
      renderInspectorTree();
      break;
    case 'components':
      renderComponentTree();
      break;
    case 'timeline':
      renderTimelineView();
      break;
    case 'profiler':
      renderProfilerView();
      break;
    case 'network':
      renderNetworkView();
      break;
  }
}

/**
 * Render inspector tree
 */
function renderInspectorTree() {
  const tree = document.createElement('div');

  // Signals
  if (currentState.signals && currentState.signals.length > 0) {
    const signalsNode = createTreeNode('Signals', 'signal', currentState.signals.length);
    currentState.signals.forEach((signal) => {
      const node = createTreeNode(signal.name || signal.id, 'signal', signal);
      signalsNode.appendChild(node);
    });
    tree.appendChild(signalsNode);
  }

  // Computed
  if (currentState.computed && currentState.computed.length > 0) {
    const computedNode = createTreeNode('Computed', 'computed', currentState.computed.length);
    currentState.computed.forEach((comp) => {
      const node = createTreeNode(comp.name || comp.id, 'computed', comp);
      computedNode.appendChild(node);
    });
    tree.appendChild(computedNode);
  }

  // Effects
  if (currentState.effects && currentState.effects.length > 0) {
    const effectsNode = createTreeNode('Effects', 'effect', currentState.effects.length);
    currentState.effects.forEach((effect) => {
      const node = createTreeNode(effect.name || effect.id, 'effect', effect);
      effectsNode.appendChild(node);
    });
    tree.appendChild(effectsNode);
  }

  // Stores
  if (currentState.stores && currentState.stores.length > 0) {
    const storesNode = createTreeNode('Stores', 'store', currentState.stores.length);
    currentState.stores.forEach((store) => {
      const node = createTreeNode(store.name, 'store', store);
      storesNode.appendChild(node);
    });
    tree.appendChild(storesNode);
  }

  treeView.appendChild(tree);
}

/**
 * Render component tree
 */
function renderComponentTree() {
  const tree = document.createElement('div');
  tree.innerHTML = '<div class="status">Component tree view - Coming soon</div>';
  treeView.appendChild(tree);
}

/**
 * Render timeline view
 */
function renderTimelineView() {
  const tree = document.createElement('div');
  tree.innerHTML = '<div class="status">Timeline view - Coming soon</div>';
  treeView.appendChild(tree);
}

/**
 * Render profiler view
 */
function renderProfilerView() {
  const tree = document.createElement('div');
  tree.innerHTML = '<div class="status">Profiler view - Coming soon</div>';
  treeView.appendChild(tree);
}

/**
 * Render network view
 */
function renderNetworkView() {
  const tree = document.createElement('div');
  tree.innerHTML = '<div class="status">Network view - Coming soon</div>';
  treeView.appendChild(tree);
}

/**
 * Create tree node element
 */
function createTreeNode(label, type, data) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const labelEl = document.createElement('div');
  labelEl.className = 'tree-label';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = getIcon(type);

  const text = document.createElement('span');
  text.textContent = typeof data === 'number' ? `${label} (${data})` : label;

  labelEl.appendChild(icon);
  labelEl.appendChild(text);
  node.appendChild(labelEl);

  // Click handler
  if (typeof data === 'object') {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      handleNodeSelect(node, data);
    });
  }

  return node;
}

/**
 * Get icon for type
 */
function getIcon(type) {
  switch (type) {
    case 'signal':
      return '○';
    case 'computed':
      return '◉';
    case 'effect':
      return '⚡';
    case 'store':
      return '◻';
    case 'component':
      return '⚙';
    default:
      return '•';
  }
}

/**
 * Handle node selection
 */
function handleNodeSelect(node, data) {
  // Remove previous selection
  document.querySelectorAll('.tree-node.selected').forEach((n) => {
    n.classList.remove('selected');
  });

  // Add selection
  node.classList.add('selected');
  selectedNode = data;

  // Display details
  displayNodeDetails(data);
}

/**
 * Display node details
 */
function displayNodeDetails(data) {
  mainContent.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = data.name || data.id || 'Details';

  const properties = document.createElement('div');
  properties.className = 'property-grid';

  // Display properties
  for (const [key, value] of Object.entries(data)) {
    if (key === 'stack' || key === 'dependencies') continue;

    const label = document.createElement('div');
    label.className = 'property-label';
    label.textContent = key;

    const valueEl = document.createElement('div');
    valueEl.className = 'property-value';
    valueEl.textContent = formatValue(value);

    properties.appendChild(label);
    properties.appendChild(valueEl);
  }

  card.appendChild(title);
  card.appendChild(properties);

  // Show value as JSON if available
  if (data.value !== undefined) {
    const valueCard = document.createElement('div');
    valueCard.className = 'card';

    const valueTitle = document.createElement('div');
    valueTitle.className = 'card-title';
    valueTitle.textContent = 'Value';

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(data.value, null, 2);

    valueCard.appendChild(valueTitle);
    valueCard.appendChild(pre);
    mainContent.appendChild(valueCard);
  }

  mainContent.appendChild(card);
}

/**
 * Format value for display
 */
function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * Handle refresh
 */
function handleRefresh() {
  console.log('[Aether DevTools] Refresh');
  requestState();
}

/**
 * Handle clear
 */
function handleClear() {
  console.log('[Aether DevTools] Clear');
  currentState = null;
  selectedNode = null;
  renderTree();
  mainContent.innerHTML = '<div class="empty-state"><h3>Cleared</h3></div>';
}

/**
 * Handle record toggle
 */
function handleRecord() {
  isRecording = !isRecording;
  recordBtn.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
  console.log('[Aether DevTools] Recording:', isRecording);

  if (window.devToolsPort) {
    window.devToolsPort.postMessage({
      type: 'toggle-recording',
      value: isRecording,
      timestamp: Date.now(),
    });
  }
}

/**
 * Handle profile toggle
 */
function handleProfile() {
  isProfiling = !isProfiling;
  profileBtn.textContent = isProfiling ? 'Stop Profiling' : 'Start Profiling';
  console.log('[Aether DevTools] Profiling:', isProfiling);

  if (window.devToolsPort) {
    window.devToolsPort.postMessage({
      type: 'toggle-profiling',
      value: isProfiling,
      timestamp: Date.now(),
    });
  }
}

/**
 * Handle tab switch
 */
function handleTabSwitch(tab) {
  // Update active tab
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.remove('active');
  });
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');

  activeTab = tab;
  renderTree();
}

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

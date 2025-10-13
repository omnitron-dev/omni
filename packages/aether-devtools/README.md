# Aether DevTools Browser Extension

Browser extension for debugging and inspecting Aether framework applications.

## Features

- **State Inspector**: Track and inspect signals, computed values, effects, and stores
- **Component Tree**: Visualize component hierarchy and relationships
- **Time-Travel Debugging**: Record and replay state changes with undo/redo
- **Performance Profiler**: Measure render times and identify bottlenecks
- **Network Inspector**: Monitor netron-browser RPC calls and WebSocket connections
- **Custom Formatters**: Enhanced Chrome DevTools console output

## Installation

### Development

1. Build the extension:
```bash
cd packages/aether-devtools
# Copy files to build directory
```

2. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `packages/aether-devtools` directory

### From Chrome Web Store

Coming soon!

## Usage

### Enable DevTools in Your App

Add this to your Aether app's entry point:

```typescript
import { enableDevTools } from '@omnitron-dev/aether/devtools';

if (import.meta.env.DEV) {
  enableDevTools({
    trackSignals: true,
    trackComponents: true,
    enableTimeTravel: true,
    enableProfiler: true,
    enableNetwork: true
  });
}
```

### Using DevTools

1. Open Chrome DevTools (F12)
2. Navigate to the "Aether" tab
3. Inspect your app's reactive state, components, and performance

### Available Tabs

- **Inspector**: View all signals, computed values, effects, and stores
- **Components**: Navigate component tree and inspect props/state
- **Timeline**: Time-travel through state history
- **Profiler**: Measure and analyze performance
- **Network**: Monitor netron-browser requests and WebSocket activity

## Development

### Structure

```
aether-devtools/
├── manifest.json          # Extension manifest (Manifest V3)
├── devtools.html         # DevTools entry point
├── panel.html            # Main panel UI
├── src/
│   ├── background.js     # Background service worker
│   ├── content.js        # Content script (injected into pages)
│   ├── devtools.js       # DevTools initialization
│   └── panel.js          # Panel UI logic
└── public/
    ├── icon16.png        # 16x16 icon
    ├── icon48.png        # 48x48 icon
    └── icon128.png       # 128x128 icon
```

### Building

The extension uses plain JavaScript for maximum compatibility. No build step required for basic functionality.

For production:
1. Generate icons (16x16, 48x48, 128x128)
2. Zip the directory
3. Upload to Chrome Web Store

## Architecture

### Communication Flow

```
Aether App (Page)
    ↕ (window.postMessage)
Content Script
    ↕ (chrome.runtime.connect)
Background Script
    ↕ (chrome.runtime.connect)
DevTools Panel
```

### Components

1. **Content Script**: Injected into every page, acts as bridge between app and extension
2. **Background Script**: Service worker managing connections between content script and panel
3. **DevTools Panel**: UI for inspecting and debugging

## API

### Window API

The extension looks for `window.__AETHER_DEVTOOLS__` to detect Aether apps.

### Messages

Messages use the following format:

```typescript
{
  type: 'state-update' | 'history-update' | 'profile-update' | 'network-event',
  payload: any,
  timestamp: number
}
```

## Browser Support

- Chrome/Edge: Full support (Manifest V3)
- Firefox: Coming soon (requires Manifest V2 adapter)

## Contributing

1. Make changes to extension files
2. Test in Chrome with "Load unpacked"
3. Submit PR with changes

## License

MIT

## Related

- [@omnitron-dev/aether](../aether) - Aether framework
- [DevTools Documentation](../../docs/devtools.md) - Full DevTools guide

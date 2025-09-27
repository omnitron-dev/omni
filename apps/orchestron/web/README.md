# Orchestron Web Panel

## Overview

The Orchestron Web Panel is a modern React-based web interface for the Orchestron Development Orchestration System. It provides a comprehensive dashboard for managing development tasks, multi-agent coordination, and project analytics.

## Features

- **Session Management**: Browse and manage development sessions
- **Agent Management**: Configure and control multi-agent orchestration
- **Hook System**: Create and manage development automation hooks
- **Real-time Updates**: WebSocket-based live updates
- **Task Tracking**: Visual task management and progress tracking
- **Analytics Dashboard**: ML-powered insights and predictions

## Architecture

The web panel is built with:
- **React 18** for the UI framework
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Vite** for fast builds and HMR
- **WebSocket** for real-time communication

## Setup

### Installation

```bash
# From the orchestron directory
cd apps/orchestron

# Install dependencies
npm install

# Build both backend and web
npm run build
```

### Development

```bash
# Start the backend server
npm run server:dev

# In another terminal, start the web dev server
npm run web
```

The web panel will be available at http://localhost:5173

### Production

```bash
# Build everything
npm run build

# Start the server (serves both API and web panel)
npm run server
```

The production build will be available at http://localhost:3001

## API Integration

The web panel communicates with the Orchestron backend through:
- **REST API** at http://localhost:3001/api
- **WebSocket** at ws://localhost:3002

### Key API Endpoints

- `/api/dashboard` - Dashboard data
- `/api/stats` - Project statistics
- `/api/tasks` - Task management
- `/api/sprints` - Sprint tracking
- `/api/agents` - Agent management
- `/api/hooks` - Hook configuration
- `/api/sessions` - Session management

## Build Configuration

### Directory Structure

```
apps/orchestron/
├── src/              # Backend source
├── web/              # Web panel source
│   ├── src/          # React components
│   └── index.html    # Entry HTML
├── dist/             # Backend build output
└── dashboard/        # Web panel build output
```

### Build Scripts

- `npm run build:backend` - Build TypeScript backend
- `npm run build:web` - Build React web panel
- `npm run build` - Build both

## Environment Variables

Configure these in `.env`:

```env
# API Configuration
ORCHESTRON_DASHBOARD_PORT=3001
ORCHESTRON_DASHBOARD_HOST=0.0.0.0

# Web Panel Configuration (development)
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3002
```

## Migrating from Tauri

The web panel was originally designed for Tauri desktop app. Key changes:
- Replaced `@tauri-apps/api` with HTTP/WebSocket client
- Added `tauri-compat.ts` for backward compatibility
- Removed analytics and PostHog integration
- Server-side file operations through API

## Contributing

1. Follow the existing React component patterns
2. Use TypeScript for all new components
3. Maintain Tailwind CSS styling conventions
4. Add tests for new features
5. Update this README for significant changes

## License

MIT - Part of the Orchestron Development System
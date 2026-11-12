# Netron browser guides

Start with the [package README](../README.md) for client creation and supported transports. The browser client connects to Netron services over HTTP or WebSocket; it does not embed the Node server runtime.

- [Cookie authentication](cookie-mode-quickstart.md): browser credentials, server cookie configuration, and CSRF handling.
- [Client entry points](../src/client/index.ts): the exported client implementations.
- [Public types](../src/types/index.ts): options, connection state, and service contracts.
- [Tests](../tests/README.md): unit, server integration, and browser runners.
- [Integration tests](../tests/integration/README.md): transport and protocol coverage against Titan.

Use the entry points declared in [package.json](../package.json). Client options and server policy must agree; a browser-side authentication setting does not configure server authorization.

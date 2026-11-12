# Titan source examples

This directory contains application and service examples. They use repository source imports and are not exported package entry points.

For current application APIs, start with the [application guide](../src/application/README.md), [dependency injection](../src/nexus/README.md), and [Netron](../src/netron/README.md). New applications should import public `@omnitron-dev/titan` entry points rather than copy internal source paths.

Useful source references include:

- [Simple application](simple-app.ts): a module, a service, and start/stop hooks.
- [Validation](validation-example.ts): method schemas and validation middleware.
- [Error handling](error-system-demo.ts): structured errors and contracts.
- [Configuration](config-usage.ts): schema-based application configuration.

Examples vary in their configuration and infrastructure requirements; they are not a single runnable test suite. [Application](../test/application/), [validation](../test/validation/), and [Netron](../test/netron/) tests contain the executable contract checks.

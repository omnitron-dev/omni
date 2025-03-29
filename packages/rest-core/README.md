# @devgrid/rest-core

`rest-core` is the foundational package of the `ts-rest` ecosystem - a TypeScript-first library for building type-safe REST APIs. It provides a robust set of tools for defining and consuming RESTful APIs with end-to-end type safety.

As part of the `ts-rest` framework (https://github.com/ts-rest/ts-rest), `rest-core` enables developers to create strongly-typed API contracts that can be shared between client and server implementations. This approach ensures consistency and reduces errors across the entire API lifecycle.

## Core Capabilities

- **Type-Safe API Contracts**: Define your API endpoints with strict typing using Zod schemas
- **Automatic Type Inference**: Generate TypeScript types directly from your API definitions
- **Comprehensive HTTP Support**: Full support for all major HTTP methods and status codes
- **Validation Layer**: Built-in data validation powered by Zod for both requests and responses
- **Middleware Support**: Extend functionality with custom middleware for authentication, logging, etc.
- **Error Handling**: Structured error handling with type-safe error responses
- **Header Management**: Type-safe header definitions and manipulation
- **Query Parameter Support**: Strongly-typed query parameters with automatic validation

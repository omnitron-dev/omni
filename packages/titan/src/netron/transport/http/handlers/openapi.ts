/**
 * OpenAPI specification generator for HTTP server
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ServiceDescriptor } from './types.js';

/**
 * OpenAPI specification generator
 */
export class OpenApiGenerator {
  constructor(
    private services: Map<string, ServiceDescriptor>,
    private serverAddress: string,
    private serverPort: number
  ) {}

  /**
   * Generate OpenAPI specification
   */
  generate(): Record<string, unknown> {
    const spec: Record<string, unknown> = {
      openapi: '3.0.3',
      info: {
        title: 'Netron HTTP Services',
        version: '2.0.0',
        description: 'Auto-generated OpenAPI specification for Netron services',
      },
      servers: [
        {
          url: `http://${this.serverAddress}:${this.serverPort}`,
          description: 'Current server',
        },
      ],
      paths: {} as Record<string, unknown>,
      components: {
        schemas: {} as Record<string, unknown>,
        securitySchemes: {},
      },
    };

    const paths = spec['paths'] as Record<string, unknown>;
    const schemas = (spec['components'] as Record<string, unknown>)['schemas'] as Record<string, unknown>;

    // Generate paths from service methods (RPC-style POST only)
    for (const [serviceName, service] of this.services) {
      for (const [methodName, method] of service.methods) {
        const httpConfig = method.contract?.http;
        const basePath = `/rpc/${serviceName}/${methodName}`;

        if (!paths[basePath]) {
          paths[basePath] = {};
        }

        const operation: Record<string, unknown> = {
          operationId: `${serviceName}_${methodName}`,
          summary: httpConfig?.openapi?.summary || method.description || `Invoke ${serviceName}.${methodName}`,
          description: httpConfig?.openapi?.description,
          tags: httpConfig?.openapi?.tags || [serviceName],
          deprecated: httpConfig?.openapi?.deprecated || method.deprecated,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${serviceName}_${methodName}_Input`,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: `#/components/schemas/${serviceName}_${methodName}_Output`,
                  },
                },
              },
            },
            '400': {
              description: 'Bad request - Invalid input or validation failed',
            },
            '404': {
              description: 'Service or method not found',
            },
            '500': {
              description: 'Internal server error',
            },
          } as Record<string, unknown>,
        };

        // Store input schema
        if (method.contract?.input) {
          schemas[`${serviceName}_${methodName}_Input`] = {
            ...this.zodSchemaToJsonSchema(method.contract.input),
            description: `Input for ${serviceName}.${methodName}`,
          };
        }

        // Store output schema
        if (method.contract?.output) {
          schemas[`${serviceName}_${methodName}_Output`] = {
            ...this.zodSchemaToJsonSchema(method.contract.output),
            description: `Output for ${serviceName}.${methodName}`,
          };
        }

        // Add error schemas
        if (method.contract?.errors) {
          const responses = operation['responses'] as Record<string, unknown>;
          for (const [statusCode, errorSchema] of Object.entries(method.contract.errors)) {
            responses[String(statusCode)] = {
              description: 'Error response',
              content: {
                'application/json': {
                  schema: {
                    $ref: `#/components/schemas/${serviceName}_${methodName}_Error${statusCode}`,
                  },
                },
              },
            };

            schemas[`${serviceName}_${methodName}_Error${statusCode}`] = {
              ...this.zodSchemaToJsonSchema(errorSchema),
              description: `Error ${statusCode} for ${serviceName}.${methodName}`,
            };
          }
        }

        // RPC-style always uses POST
        (paths[basePath] as Record<string, unknown>)['post'] = operation;
      }
    }

    return spec;
  }

  /**
   * Convert Zod schema to JSON Schema for OpenAPI
   */
  private zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
    try {
      // Use zod-to-json-schema library to convert
      const jsonSchema = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
        target: 'openApi3',
        $refStrategy: 'none', // Inline all definitions
      });

      // Return the schema without the $schema property
      const { $schema, ...rest } = jsonSchema as Record<string, unknown>;
      return rest;
    } catch {
      // If conversion fails, return a generic object schema
      return {
        type: 'object',
        description: 'Schema conversion failed',
      };
    }
  }
}

/**
 * Handle OpenAPI specification request
 */
export function handleOpenAPIRequest(
  request: Request,
  services: Map<string, ServiceDescriptor>,
  serverAddress: string,
  serverPort: number
): Response {
  // Extract and verify authentication
  const authHeader = request.headers.get('Authorization');

  // Require authentication for OpenAPI spec
  if (!authHeader) {
    return new Response(
      JSON.stringify({
        error: {
          code: '401',
          message: 'Authentication required for API documentation',
        },
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        },
      }
    );
  }

  // Generate OpenAPI spec for authenticated users
  const generator = new OpenApiGenerator(services, serverAddress, serverPort);
  const spec = generator.generate();

  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

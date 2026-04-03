/**
 * Factory for creating a zod schema for the `omnitron` section in app config.
 *
 * Omnitron doesn't depend on zod directly — apps pass their zod instance:
 *
 *   import { z } from 'zod';
 *   import { createOmnitronConfigSchema } from '@omnitron-dev/omnitron/config';
 *   const configSchema = z.object({
 *     omnitron: createOmnitronConfigSchema(z),
 *     // ...app-specific fields
 *   });
 */

export function createOmnitronConfigSchema(z: any) {
  return z.object({
    database: z.union([z.boolean(), z.object({
      dialect: z.enum(['postgres', 'mysql', 'sqlite']).optional(),
      pool: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
      extensions: z.array(z.string()).optional(),
      dedicated: z.boolean().optional(),
    })]).optional(),
    redis: z.union([z.boolean(), z.object({
      prefix: z.string().optional(),
      dedicated: z.boolean().optional(),
    })]).optional(),
    s3: z.union([z.boolean(), z.object({
      bucket: z.string().optional(),
      quota: z.string().optional(),
    })]).optional(),
    services: z.object({
      discovery: z.boolean().optional(),
      notifications: z.boolean().optional(),
    }).optional(),
  }).optional();
}

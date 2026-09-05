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
      /** Cross-app: read priceverse price data from its Redis DB. */
      priceverse: z.boolean().optional(),
    }).optional(),
    /**
     * Custom infrastructure this app requires, keyed by logical service
     * name. The daemon reads this from the raw config file, so it worked
     * regardless — but a zod object strips what it does not declare, so an
     * app validating its own config lost the block, and one validating
     * strictly was told a correct config was wrong.
     *
     * Left as a loose record: the shape is `IServiceRequirement`, which is
     * large, evolves with the preset system, and is validated by the daemon
     * when it provisions. Declaring it here in more detail would create a
     * second definition to fall behind the first — which is the failure this
     * whole change is about.
     */
    infrastructure: z.record(z.string(), z.any()).optional(),
  }).optional();
}

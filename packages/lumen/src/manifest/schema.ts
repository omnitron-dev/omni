import { z } from 'zod';

export const AssetManifestEntrySchema = z.object({
  path: z.string(),
  sri: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  hash: z.string().optional(),
});

export const AssetManifestSchema = z.record(z.string(), z.union([z.string(), AssetManifestEntrySchema]));

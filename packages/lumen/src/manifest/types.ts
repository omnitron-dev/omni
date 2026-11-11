export interface AssetManifestEntry {
  path: string;
  sri?: string;
  sizeBytes?: number;
  hash?: string;
}

export type AssetManifest = Record<string, string | AssetManifestEntry>;

export interface GenerateAssetManifestOptions {
  carryPreviousBuildForward?: boolean;
  previousManifest?: AssetManifest | null;
}

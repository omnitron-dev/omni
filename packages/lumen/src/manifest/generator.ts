import type { AssetManifest, GenerateAssetManifestOptions } from './types.js';

export function generateAssetManifest(
  currentAssets: AssetManifest,
  options?: GenerateAssetManifestOptions
): AssetManifest {
  const prev: AssetManifest = {};
  if (options?.carryPreviousBuildForward && options.previousManifest && typeof options.previousManifest === 'object') {
    const rawPrev = options.previousManifest;
    for (const [key, val] of Object.entries(rawPrev)) {
      if ((key.startsWith('routes/') || key.endsWith('.html')) && !(key in currentAssets)) {
        continue;
      }
      prev[key] = val;
    }
  }
  return {
    ...prev,
    ...currentAssets,
  };
}

export function carryPreviousBuildForward(
  previousManifest: AssetManifest | null | undefined,
  currentManifest: AssetManifest
): AssetManifest {
  return generateAssetManifest(currentManifest, {
    carryPreviousBuildForward: true,
    previousManifest,
  });
}

import type { ParityReport } from '../types.js';

import { normalizeUrl } from './normalizer.js';
import { crawlDocumentationDirectory } from './crawler.js';

export function compareUrlArrays(sourceUrls: string[], targetUrls: string[]): ParityReport {
  const rawTargetSet = new Set(targetUrls);
  const normalizedTargets = new Map<string, string>();
  for (const url of targetUrls) if (!normalizedTargets.has(normalizeUrl(url))) normalizedTargets.set(normalizeUrl(url), url);

  const missingRoutes: string[] = [];
  const missingAnchors: string[] = [];
  const matchedRoutesMap = new Map<string, string>();

  let totalRoutes = 0;
  let matchedRoutes = 0;
  let totalAnchors = 0;
  let matchedAnchors = 0;

  for (const rawUrl of new Set(sourceUrls)) {
    const isAnchor = rawUrl.includes('#');
    const normUrl = normalizeUrl(rawUrl);
    const target = rawTargetSet.has(rawUrl) ? rawUrl : normalizedTargets.get(normUrl);
    const isMatched = target !== undefined;

    if (isAnchor) {
      totalAnchors++;
      if (isMatched) {
        matchedAnchors++;
      } else {
        missingAnchors.push(rawUrl);
      }
    } else {
      totalRoutes++;
      if (isMatched) {
        matchedRoutes++;
        matchedRoutesMap.set(rawUrl, target!);
      } else {
        missingRoutes.push(rawUrl);
      }
    }
  }

  const totalItems = totalRoutes + totalAnchors;
  const passed = totalItems > 0 && missingRoutes.length === 0 && missingAnchors.length === 0;
  const matchedItems = matchedRoutes + matchedAnchors;
  const parityScore = totalItems === 0 ? 0 : Number((matchedItems / totalItems).toFixed(4));

  return {
    passed,
    routes: {
      total: totalRoutes,
      preserved: matchedRoutes,
      missing: missingRoutes,
      matched: Object.fromEntries(matchedRoutesMap),
    },
    anchors: {
      total: totalAnchors,
      preserved: matchedAnchors,
      missing: missingAnchors,
    },
    parityScore,
  };
}

export function compareDirectories(sourceDir: string, targetDir: string): ParityReport {
  const sourceCrawled = crawlDocumentationDirectory(sourceDir);
  const targetCrawled = crawlDocumentationDirectory(targetDir);

  return compareUrlArrays(sourceCrawled.allUrls, targetCrawled.allUrls);
}

export function verifyUrlAndAnchorParity(source: string[] | string, target: string[] | string): ParityReport {
  if (Array.isArray(source) && Array.isArray(target)) {
    return compareUrlArrays(source, target);
  }

  if (typeof source === 'string' && typeof target === 'string') {
    return compareDirectories(source, target);
  }

  throw new Error('Invalid arguments passed to verifyUrlAndAnchorParity');
}

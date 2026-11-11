import type { ParityReport } from '../types.js';
import { normalizeUrl } from './normalizer.js';
import { crawlDocumentationDirectory } from './crawler.js';

export function compareUrlArrays(sourceUrls: string[], targetUrls: string[]): ParityReport {
  const rawTargetSet = new Set(targetUrls);
  const normalizedTargetSet = new Set(targetUrls.map(normalizeUrl));

  const missingRoutes: string[] = [];
  const missingAnchors: string[] = [];
  const matchedRoutesMap: Record<string, string> = {};

  let totalRoutes = 0;
  let matchedRoutes = 0;
  let totalAnchors = 0;
  let matchedAnchors = 0;

  for (const rawUrl of sourceUrls) {
    const isAnchor = rawUrl.includes('#');
    const normUrl = normalizeUrl(rawUrl);
    const isMatched = rawTargetSet.has(rawUrl) || normalizedTargetSet.has(normUrl);

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
        matchedRoutesMap[rawUrl] = normUrl;
      } else {
        missingRoutes.push(rawUrl);
      }
    }
  }

  const passed = missingRoutes.length === 0 && missingAnchors.length === 0;
  const totalItems = totalRoutes + totalAnchors;
  const matchedItems = matchedRoutes + matchedAnchors;
  const parityScore = totalItems === 0 ? 1.0 : Number((matchedItems / totalItems).toFixed(4));

  return {
    totalRoutes,
    matchedRoutes,
    missingRoutes,
    totalAnchors,
    matchedAnchors,
    missingAnchors,
    passed,
    routes: {
      total: totalRoutes,
      preserved: matchedRoutes,
      missing: missingRoutes,
      matched: matchedRoutesMap,
    },
    anchors: {
      total: totalAnchors,
      preserved: matchedAnchors,
      missing: missingAnchors,
    },
    links: {
      total: 0,
      valid: 0,
      broken: [],
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

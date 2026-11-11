/**
 * Normalization utilities for URLs and in-page anchors.
 */

export function normalizeAnchor(anchor: string): string {
  if (!anchor) return '';
  const hashIdx = anchor.indexOf('#');
  const rawHash = hashIdx !== -1 ? anchor.slice(hashIdx + 1) : anchor;
  try {
    return `#${decodeURIComponent(rawHash)}`;
  } catch {
    return `#${rawHash}`;
  }
}

export function normalizeUrl(url: string): string {
  if (!url) return '';

  const hashIdx = url.indexOf('#');
  let routePart = hashIdx !== -1 ? url.slice(0, hashIdx) : url;
  const anchorPart = hashIdx !== -1 ? url.slice(hashIdx) : '';

  // Decode URI encoding in route if any
  try {
    routePart = decodeURI(routePart);
  } catch {
    // ignore
  }

  // Normalize trailing slash: /docs/intro/ -> /docs/intro
  if (routePart.length > 1 && routePart.endsWith('/')) {
    routePart = routePart.slice(0, -1);
  }

  if (anchorPart) {
    return `${routePart}${normalizeAnchor(anchorPart)}`;
  }

  return routePart;
}

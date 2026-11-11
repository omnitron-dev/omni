import { posix } from 'node:path';
import type {
  CorpusDocument,
  CorpusMathObject,
  AnchorResolutionResult,
  LinkResolutionResult,
  OutdatedTranslation,
} from './types.js';

function normalizeSlashPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function stripDocExtension(p: string): string {
  return p.replace(/\.(pdx|md)$/, '');
}

function docContainsAnchor(doc: CorpusDocument, anchor: string): boolean {
  if (!anchor) return false;
  if (Array.isArray(doc.anchors) && doc.anchors.includes(anchor)) {
    return true;
  }
  if (Array.isArray(doc.headers) && doc.headers.some((h) => h.id === anchor)) {
    return true;
  }
  if (Array.isArray(doc.mathObjects) && doc.mathObjects.some((m) => m.id === anchor)) {
    return true;
  }
  return false;
}

export class CorpusGraph {
  private readonly documents = new Map<string, CorpusDocument>();
  private readonly mathObjects = new Map<string, CorpusMathObject>();
  private readonly docMathObjects = new Map<string, Set<string>>();
  private readonly backlinksIndex = new Map<string, Set<string>>();
  private readonly docDependencies = new Map<string, Set<string>>();
  private readonly translations = new Map<string, Map<string, CorpusDocument>>();

  addDocument(doc: CorpusDocument): void {
    // 0. Enforce unique math identity ownership within the same locale BEFORE mutating any internal state
    if (Array.isArray(doc.mathObjects)) {
      const seenIncomingIds = new Set<string>();
      for (const math of doc.mathObjects) {
        if (!math?.id) continue;
        const existingOwner = this.mathObjects.get(math.id);
        if (existingOwner && existingOwner.docId && existingOwner.docId !== doc.id) {
          const existingOwnerDoc = this.documents.get(existingOwner.docId);
          const isDistinctLocaleTranslation = Boolean(
            existingOwnerDoc?.locale && doc.locale && existingOwnerDoc.locale !== doc.locale
          );
          if (!isDistinctLocaleTranslation) {
            throw new Error(
              `Duplicate math object ID "${math.id}" is already owned by document "${existingOwner.docId}"`
            );
          }
        }
        if (seenIncomingIds.has(math.id)) {
          throw new Error(`Duplicate math object ID "${math.id}" declared multiple times in document "${doc.id}"`);
        }
        seenIncomingIds.add(math.id);
      }
    }

    // 1. Purge old forward dependencies from backlinksIndex on overwrite
    const oldDeps = this.docDependencies.get(doc.id);
    if (oldDeps) {
      for (const dep of oldDeps) {
        this.backlinksIndex.get(dep)?.delete(doc.id);
      }
    }

    // 2. Purge old math objects owned by this document ID on overwrite
    const oldMathIds = this.docMathObjects.get(doc.id);
    if (oldMathIds) {
      for (const mathId of oldMathIds) {
        if (this.mathObjects.get(mathId)?.docId === doc.id) {
          this.mathObjects.delete(mathId);
        }
      }
    }
    // Defensive cleanup: purge any lingering math objects belonging to doc.id
    for (const [mathId, math] of this.mathObjects.entries()) {
      if (math.docId === doc.id) {
        this.mathObjects.delete(mathId);
      }
    }

    this.documents.set(doc.id, doc);

    // 3. Register new math objects (preserving primary locale owner if already registered by another locale)
    const currentMathIds = new Set<string>();
    if (doc.mathObjects) {
      for (const math of doc.mathObjects) {
        const existing = this.mathObjects.get(math.id);
        if (!existing || existing.docId === doc.id) {
          this.mathObjects.set(math.id, { ...math, docId: doc.id });
        }
        currentMathIds.add(math.id);
      }
    }
    this.docMathObjects.set(doc.id, currentMathIds);

    // 4. Register forward dependencies and backlinks
    const currentDeps = new Set<string>();
    const registerDep = (depId: string) => {
      currentDeps.add(depId);
      let bl = this.backlinksIndex.get(depId);
      if (!bl) {
        bl = new Set();
        this.backlinksIndex.set(depId, bl);
      }
      bl.add(doc.id);
    };

    if (doc.relations?.dependsOn) {
      for (const dep of doc.relations.dependsOn) {
        registerDep(dep);
      }
    }

    const fmDeps = doc.frontmatter?.['dependsOn'];
    if (Array.isArray(fmDeps)) {
      for (const dep of fmDeps) {
        if (typeof dep === 'string') {
          registerDep(dep);
        }
      }
    }

    this.docDependencies.set(doc.id, currentDeps);

    // 5. Track translations if locale present
    if (doc.locale) {
      const canonicalId =
        (doc.frontmatter?.['canonicalId'] as string | undefined) ?? doc.id.replace(new RegExp(`^${doc.locale}/`), '');
      if (!this.translations.has(canonicalId)) {
        this.translations.set(canonicalId, new Map());
      }
      this.translations.get(canonicalId)!.set(doc.locale, doc);
    }
  }

  addMathObject(math: CorpusMathObject): void {
    const existing = this.mathObjects.get(math.id);
    if (existing && (existing.docId || math.docId) && existing.docId !== math.docId) {
      throw new Error(
        `Duplicate math object ID "${math.id}" is already owned by document "${existing.docId ?? 'unknown'}"`
      );
    }

    this.mathObjects.set(math.id, math);
    if (math.docId) {
      let ids = this.docMathObjects.get(math.docId);
      if (!ids) {
        ids = new Set();
        this.docMathObjects.set(math.docId, ids);
      }
      ids.add(math.id);
    }
  }

  getDocument(id: string): CorpusDocument | undefined {
    return this.documents.get(id);
  }

  getAllDocuments(): CorpusDocument[] {
    return Array.from(this.documents.values());
  }

  getBacklinks(id: string): string[] {
    return Array.from(this.backlinksIndex.get(id) ?? []);
  }

  resolveMathRef(targetId: string): CorpusMathObject | undefined {
    return this.mathObjects.get(targetId);
  }

  /**
   * Resolves a relative link against the directory of `fromDoc` when `fromDoc` exists.
   */
  private findDocumentRelativeToSource(fromDoc: CorpusDocument, rawDocPart: string): CorpusDocument | undefined {
    const slashHref = rawDocPart.replace(/\\/g, '/').trim();
    if (!slashHref || slashHref.startsWith('/')) {
      return undefined;
    }

    const normFromPath = normalizeSlashPath(fromDoc.path);
    const fromDir = posix.dirname(normFromPath);
    const joined = fromDir === '.' ? posix.normalize(slashHref) : posix.normalize(posix.join(fromDir, slashHref));

    if (!joined || joined === '.' || joined.startsWith('..')) {
      return undefined;
    }

    const joinedStem = stripDocExtension(joined);
    for (const candidate of this.documents.values()) {
      const candidateStem = stripDocExtension(normalizeSlashPath(candidate.path));
      if (candidateStem === joinedStem || candidateStem === `${joinedStem}/index`) {
        return candidate;
      }
    }

    return undefined;
  }

  /**
   * Helper to look up a document by exact ID, exact path, normalized path stem,
   * routePath, or unambiguous path segment suffix.
   */
  private findDocumentByRef(ref: string): CorpusDocument | undefined {
    if (!ref || ref.trim() === '') {
      return undefined;
    }
    const slashRef = ref.replace(/\\/g, '/').trim();
    const clean = stripDocExtension(slashRef).replace(/^\.?\//, '');
    if (!clean || clean === '.' || clean.startsWith('..')) {
      return undefined;
    }

    // 1. Direct ID match (O(1))
    const byId = this.documents.get(clean);
    if (byId) return byId;

    // 2. Exact match on id, path, or routePath
    for (const doc of this.documents.values()) {
      if (doc.id === clean) return doc;

      const normDocPath = stripDocExtension(normalizeSlashPath(doc.path));
      if (doc.path === slashRef || doc.path === clean || normDocPath === clean) return doc;

      if (doc.routePath) {
        const normRoute = doc.routePath.replace(/^\.?\//, '');
        if (normRoute === clean || doc.routePath === slashRef) return doc;
      }
    }

    // 3. Unambiguous suffix match on path segment boundary (e.g. 'tutorials/guide' matches 'docs/tutorials/guide')
    const suffixMatches: CorpusDocument[] = [];
    for (const doc of this.documents.values()) {
      const normDocPath = stripDocExtension(normalizeSlashPath(doc.path));
      if (normDocPath.endsWith(`/${clean}`)) {
        suffixMatches.push(doc);
      }
    }

    if (suffixMatches.length === 1) {
      return suffixMatches[0];
    }

    return undefined;
  }

  resolveAnchor(href: string, fromDocId?: string): AnchorResolutionResult {
    if (!href || href.trim() === '') {
      return { resolved: false };
    }

    const hashIdx = href.indexOf('#');
    const docPart = (hashIdx === -1 ? href : href.slice(0, hashIdx)).trim();
    const anchorPart = hashIdx === -1 ? undefined : href.slice(hashIdx + 1).trim();
    const cleanDoc = stripDocExtension(docPart).replace(/^\.?\//, '');

    // Local anchor reference within a document (e.g. '#install')
    if (!cleanDoc) {
      if (!anchorPart || anchorPart.length === 0) {
        return { resolved: false };
      }

      if (fromDocId !== undefined) {
        const sourceDoc = this.documents.get(fromDocId);
        if (sourceDoc && docContainsAnchor(sourceDoc, anchorPart)) {
          return { resolved: true, targetDocId: sourceDoc.id, anchor: anchorPart };
        }
        return {
          resolved: false,
          ...(sourceDoc ? { targetDocId: sourceDoc.id } : {}),
          anchor: anchorPart,
        };
      }

      // When fromDocId is omitted, verify that at least one document in the corpus owns this anchor
      for (const doc of this.documents.values()) {
        if (docContainsAnchor(doc, anchorPart)) {
          return { resolved: true, anchor: anchorPart };
        }
      }

      return { resolved: false, anchor: anchorPart };
    }

    // Cross-document reference (with optional `#anchor`)
    let targetDoc: CorpusDocument | undefined;
    if (fromDocId !== undefined) {
      const linkRes = this.resolveLink(fromDocId, docPart);
      if (linkRes.resolved && linkRes.targetDocId) {
        targetDoc = this.documents.get(linkRes.targetDocId);
      }
    } else {
      targetDoc = this.findDocumentByRef(docPart);
    }

    if (targetDoc) {
      if (anchorPart !== undefined) {
        if (!anchorPart) {
          return { resolved: false, targetDocId: targetDoc.id };
        }
        if (docContainsAnchor(targetDoc, anchorPart)) {
          return { resolved: true, targetDocId: targetDoc.id, anchor: anchorPart };
        }
        return { resolved: false, targetDocId: targetDoc.id, anchor: anchorPart };
      }
      return { resolved: true, targetDocId: targetDoc.id };
    }

    return { resolved: false };
  }

  resolveLink(fromDocId: string, href: string): LinkResolutionResult {
    if (!href || href.trim() === '') {
      return { resolved: false };
    }

    const docPart = (href.split('#')[0] ?? '').trim();
    if (!docPart) {
      return { resolved: false };
    }

    const slashDocPart = docPart.replace(/\\/g, '/');
    const isExplicitRelative = slashDocPart.startsWith('./') || slashDocPart.startsWith('../');
    const fromDoc = fromDocId ? this.documents.get(fromDocId) : undefined;

    // 1. Resolve relative to source document's directory first when `fromDoc` exists in the graph
    if (fromDoc && !slashDocPart.startsWith('/')) {
      const relativeMatch = this.findDocumentRelativeToSource(fromDoc, slashDocPart);
      if (relativeMatch) {
        return { resolved: true, targetDocId: relativeMatch.id };
      }
      // Explicit `./` or `../` from a known source document must NOT fall back to unrelated directories
      if (isExplicitRelative) {
        return { resolved: false };
      }
    }

    // 2. Fallback to exact ID / corpus path / unambiguous suffix resolution
    const found = this.findDocumentByRef(slashDocPart);
    if (found) {
      return { resolved: true, targetDocId: found.id };
    }

    return { resolved: false };
  }

  getTopologicalOrder(): string[] {
    const adj = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const id of this.documents.keys()) {
      adj.set(id, new Set());
      inDegree.set(id, 0);
    }

    for (const [fromId, doc] of this.documents.entries()) {
      // Gather dependencies from relations and frontmatter
      const rawDeps: string[] = [];
      if (doc.relations?.dependsOn && Array.isArray(doc.relations.dependsOn)) {
        rawDeps.push(...doc.relations.dependsOn);
      }
      const fmDeps = doc.frontmatter?.['dependsOn'];
      if (Array.isArray(fmDeps)) {
        for (const dep of fmDeps) {
          if (typeof dep === 'string') {
            rawDeps.push(dep);
          }
        }
      }

      // Deduplicate dependencies via Set before in-degree calculations
      const uniqueDeps = new Set(rawDeps);
      for (const dep of uniqueDeps) {
        if (adj.has(dep)) {
          adj.get(dep)!.add(fromId);
          inDegree.set(fromId, (inDegree.get(fromId) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      order.push(curr);

      for (const neighbor of adj.get(curr) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Safety for cyclic graphs: append remaining unvisited nodes deterministically without hanging
    if (order.length < this.documents.size) {
      for (const id of this.documents.keys()) {
        if (!order.includes(id)) {
          order.push(id);
        }
      }
    }

    return order;
  }

  detectMathCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];

    const dfs = (nodeId: string) => {
      visited.add(nodeId);
      inStack.add(nodeId);
      stack.push(nodeId);

      const mathObj = this.mathObjects.get(nodeId);
      const deps = mathObj?.dependsOn ?? [];

      for (const depId of deps) {
        if (!visited.has(depId)) {
          if (this.mathObjects.has(depId)) {
            dfs(depId);
          }
        } else if (inStack.has(depId)) {
          const cycleStartIdx = stack.indexOf(depId);
          if (cycleStartIdx !== -1) {
            cycles.push([...stack.slice(cycleStartIdx), depId]);
          }
        }
      }

      stack.pop();
      inStack.delete(nodeId);
    };

    for (const id of this.mathObjects.keys()) {
      if (!visited.has(id)) {
        dfs(id);
      }
    }

    return cycles;
  }

  getOutdatedTranslations(): OutdatedTranslation[] {
    const outdated: OutdatedTranslation[] = [];

    for (const [canonicalId, locMap] of this.translations.entries()) {
      const canonicalDoc = this.documents.get(canonicalId);
      const canonicalSha = canonicalDoc?.hash;

      for (const [locale, locDoc] of locMap.entries()) {
        const locRefSha = (locDoc.frontmatter?.['canonicalSha256'] as string | undefined) ?? locDoc.hash;
        if (canonicalSha && locRefSha && canonicalSha !== locRefSha) {
          outdated.push({ locale, canonicalId });
        }
      }
    }

    return outdated;
  }

  invalidate(docId: string): Set<string> {
    const affected = new Set<string>([docId]);
    const queue = [docId];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const dependents = this.backlinksIndex.get(curr) ?? [];
      for (const dep of dependents) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }

    return affected;
  }

  clear(): void {
    this.documents.clear();
    this.mathObjects.clear();
    this.docMathObjects.clear();
    this.backlinksIndex.clear();
    this.docDependencies.clear();
    this.translations.clear();
  }

  size(): number {
    return this.documents.size;
  }
}

import type {
  CorpusDocument,
  CorpusMathObject,
  AnchorResolutionResult,
  LinkResolutionResult,
  OutdatedTranslation,
} from './types.js';

export class CorpusGraph {
  private readonly documents = new Map<string, CorpusDocument>();
  private readonly mathObjects = new Map<string, CorpusMathObject>();
  private readonly docMathObjects = new Map<string, Set<string>>();
  private readonly backlinksIndex = new Map<string, Set<string>>();
  private readonly docDependencies = new Map<string, Set<string>>();
  private readonly translations = new Map<string, Map<string, CorpusDocument>>();

  addDocument(doc: CorpusDocument): void {
    // 1. Purge old forward dependencies from backlinksIndex on overwrite
    const oldDeps = this.docDependencies.get(doc.id);
    if (oldDeps) {
      for (const dep of oldDeps) {
        this.backlinksIndex.get(dep)?.delete(doc.id);
      }
    }

    // 2. Purge old math objects registered by this document ID on overwrite
    const oldMathIds = this.docMathObjects.get(doc.id);
    if (oldMathIds) {
      for (const mathId of oldMathIds) {
        this.mathObjects.delete(mathId);
      }
    }
    // Defensive cleanup: purge any lingering math objects belonging to doc.id
    for (const [mathId, math] of this.mathObjects.entries()) {
      if (math.docId === doc.id) {
        this.mathObjects.delete(mathId);
      }
    }

    this.documents.set(doc.id, doc);

    // 3. Register new math objects and record their IDs in docMathObjects
    const currentMathIds = new Set<string>();
    if (doc.mathObjects) {
      for (const math of doc.mathObjects) {
        this.mathObjects.set(math.id, { ...math, docId: doc.id });
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
   * Helper to look up a document by exact ID, exact path, normalized path stem,
   * routePath, or path suffix (e.g. 'guide' matching 'docs/guide.pdx').
   * Guarantees that empty strings and substring false-positives are rejected.
   */
  private findDocumentByRef(ref: string): CorpusDocument | undefined {
    if (!ref || ref.trim() === '') {
      return undefined;
    }
    const clean = ref.replace(/\.(pdx|md)$/, '').replace(/^\.?\//, '');
    if (!clean) {
      return undefined;
    }

    // 1. Direct ID match (O(1))
    const byId = this.documents.get(clean);
    if (byId) return byId;

    // 2. Exact match on id, path, or routePath
    for (const doc of this.documents.values()) {
      if (doc.id === clean) return doc;

      const normDocPath = doc.path.replace(/\.(pdx|md)$/, '').replace(/^\.?\//, '');
      if (doc.path === ref || doc.path === clean || normDocPath === clean) return doc;

      if (doc.routePath) {
        const normRoute = doc.routePath.replace(/^\.?\//, '');
        if (normRoute === clean || doc.routePath === ref) return doc;
      }
    }

    // 3. Suffix match on path segment boundary (e.g. 'guide' matches 'docs/guide')
    for (const doc of this.documents.values()) {
      const normDocPath = doc.path.replace(/\.(pdx|md)$/, '').replace(/^\.?\//, '');
      if (normDocPath.endsWith('/' + clean)) return doc;
    }

    return undefined;
  }

  resolveAnchor(href: string): AnchorResolutionResult {
    if (!href || href.trim() === '') {
      return { resolved: false };
    }

    const parts = href.split('#');
    const docPart = parts[0] ?? '';
    const anchorPart = parts[1];
    const cleanDoc = docPart.replace(/\.(pdx|md)$/, '').replace(/^\.?\//, '');

    // Local anchor reference within the current document (e.g. '#install')
    if (!cleanDoc) {
      if (anchorPart && anchorPart.trim().length > 0) {
        return { resolved: true, anchor: anchorPart };
      }
      return { resolved: false };
    }

    const doc = this.findDocumentByRef(cleanDoc);
    if (doc) {
      if (anchorPart) {
        if (doc.anchors && doc.anchors.includes(anchorPart)) {
          return { resolved: true, targetDocId: doc.id, anchor: anchorPart };
        }
        return { resolved: false, targetDocId: doc.id, anchor: anchorPart };
      }
      return { resolved: true, targetDocId: doc.id };
    }

    return { resolved: false };
  }

  resolveLink(fromDocId: string, href: string): LinkResolutionResult {
    if (!href || href.trim() === '') {
      return { resolved: false };
    }

    const docPart = href.split('#')[0] ?? '';
    const cleanHref = docPart.replace(/\.(pdx|md)$/, '').replace(/^\.?\//, '');
    if (!cleanHref) {
      return { resolved: false };
    }

    const found = this.findDocumentByRef(cleanHref);
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

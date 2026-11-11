import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface DocumentSpec {
  id: string;
  filePath: string;
  routePath?: string;
  title?: string;
  locale?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  dependsOnMathIds?: string[];
  sha256?: string;
}

export type MathEnvType =
  | 'axiom'
  | 'theorem'
  | 'definition'
  | 'lemma'
  | 'proposition'
  | 'corollary'
  | 'proof'
  | 'remark'
  | 'example'
  | 'hypothesis';

export interface MathObjectSpec {
  id: string;
  envType: MathEnvType;
  title: string;
  docId: string;
  number?: string;
  status?: 'verified' | 'draft' | 'unverified';
  dependsOn?: string[];
}

export interface CorpusBuilderOptions {
  title?: string;
  baseUrl?: string;
  defaultLocale?: string;
  locales?: string[];
}

export interface BuiltCorpusGraph {
  title: string;
  baseUrl: string;
  defaultLocale: string;
  locales: string[];
  documents: Map<string, DocumentSpec>;
  mathObjects: Map<string, MathObjectSpec>;
  backlinks: Map<string, Set<string>>;
  getTopologicalOrder(): string[];
  resolveAnchor(href: string): { resolved: boolean; targetDocId?: string; anchor?: string };
  resolveLink(fromDocId: string, href: string): { resolved: boolean; targetDocId?: string };
  resolveMathRef(targetId: string): MathObjectSpec | undefined;
  getBacklinks(docId: string): Set<string>;
  detectMathCycles(): string[][];
  getOutdatedTranslations(): Array<{ locale: string; canonicalId: string }>;
}

export class CorpusGraphBuilder {
  private config: Record<string, unknown> = {};
  private defaultLocale: string = 'en';
  private locales: string[] = ['en'];
  private title: string = 'Corpus Documentation';
  private baseUrl: string = '/';

  private documents: Map<string, DocumentSpec> = new Map();
  private mathObjects: Map<string, MathObjectSpec> = new Map();
  private links: Array<{ fromDocId: string; toDocId: string; anchor?: string }> = [];
  private smartRefs: Array<{ fromDocId: string; targetId: string; kind: 'thm' | 'api' | 'def' }> = [];
  private translations: Map<string, Map<string, DocumentSpec>> = new Map();

  static create(options?: CorpusBuilderOptions): CorpusGraphBuilder {
    const builder = new CorpusGraphBuilder();
    if (options?.title) builder.title = options.title;
    if (options?.baseUrl) builder.baseUrl = options.baseUrl;
    if (options?.defaultLocale) builder.defaultLocale = options.defaultLocale;
    if (options?.locales) builder.locales = options.locales;
    return builder;
  }

  withConfig(config: Record<string, unknown>): this {
    this.config = { ...this.config, ...config };
    return this;
  }

  withLocales(locales: string[], defaultLocale?: string): this {
    this.locales = locales;
    if (defaultLocale) this.defaultLocale = defaultLocale;
    return this;
  }

  addDocument(doc: DocumentSpec): this {
    this.documents.set(doc.id, doc);
    return this;
  }

  addMathObject(math: MathObjectSpec): this {
    this.mathObjects.set(math.id, math);
    return this;
  }

  addCrossLink(fromDocId: string, toDocId: string, anchor?: string): this {
    this.links.push({ fromDocId, toDocId, anchor });
    return this;
  }

  addSmartRef(fromDocId: string, kind: 'thm' | 'api' | 'def', targetId: string): this {
    this.smartRefs.push({ fromDocId, targetId, kind });
    return this;
  }

  addTranslation(canonicalDocId: string, locale: string, doc: DocumentSpec): this {
    if (!this.translations.has(canonicalDocId)) {
      this.translations.set(canonicalDocId, new Map());
    }
    this.translations.get(canonicalDocId)!.set(locale, doc);
    this.documents.set(`${locale}/${doc.id}`, { ...doc, locale });
    return this;
  }

  build(): BuiltCorpusGraph {
    const documents = new Map(this.documents);
    const mathObjects = new Map(this.mathObjects);
    const backlinks = new Map<string, Set<string>>();

    for (const link of this.links) {
      if (!backlinks.has(link.toDocId)) {
        backlinks.set(link.toDocId, new Set());
      }
      backlinks.get(link.toDocId)!.add(link.fromDocId);
    }

    for (const sRef of this.smartRefs) {
      const targetMath = mathObjects.get(sRef.targetId);
      if (targetMath) {
        if (!backlinks.has(targetMath.docId)) {
          backlinks.set(targetMath.docId, new Set());
        }
        backlinks.get(targetMath.docId)!.add(sRef.fromDocId);
      }
    }

    const title = this.title;
    const baseUrl = this.baseUrl;
    const defaultLocale = this.defaultLocale;
    const locales = [...this.locales];
    const translations = this.translations;

    return {
      title,
      baseUrl,
      defaultLocale,
      locales,
      documents,
      mathObjects,
      backlinks,

      getBacklinks(docId: string): Set<string> {
        return backlinks.get(docId) ?? new Set<string>();
      },

      resolveAnchor(href: string): { resolved: boolean; targetDocId?: string; anchor?: string } {
        const parts = href.split('#');
        const docPart = parts[0] ?? '';
        const anchorPart = parts[1];
        let targetDocId = docPart.replace(/\.(pdx|md)$/, '').replace(/^\.\//, '');

        if (!targetDocId && anchorPart) {
          return { resolved: true, anchor: anchorPart };
        }

        const docExists = Array.from(documents.values()).some(
          (d) => d.id === targetDocId || d.filePath.includes(targetDocId) || d.routePath === targetDocId
        );

        if (docExists) {
          return { resolved: true, targetDocId, anchor: anchorPart };
        }

        return { resolved: false };
      },

      resolveLink(fromDocId: string, href: string): { resolved: boolean; targetDocId?: string } {
        const cleanHref = (href.split('#')[0] ?? '').replace(/\.(pdx|md)$/, '').replace(/^\.\//, '');
        const found = Array.from(documents.values()).find(
          (d) => d.id === cleanHref || d.filePath.includes(cleanHref) || d.routePath === cleanHref
        );
        if (found) {
          return { resolved: true, targetDocId: found.id };
        }
        return { resolved: false };
      },

      resolveMathRef(targetId: string): MathObjectSpec | undefined {
        return mathObjects.get(targetId);
      },

      getTopologicalOrder(): string[] {
        const adj = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();

        for (const id of documents.keys()) {
          adj.set(id, new Set());
          inDegree.set(id, 0);
        }

        for (const [fromId, doc] of documents.entries()) {
          const deps = (doc.frontmatter?.dependsOn as string[] | undefined) ?? [];
          for (const dep of deps) {
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

        return order;
      },

      detectMathCycles(): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const inStack = new Set<string>();
        const stack: string[] = [];

        const dfs = (nodeId: string) => {
          visited.add(nodeId);
          inStack.add(nodeId);
          stack.push(nodeId);

          const mathObj = mathObjects.get(nodeId);
          const deps = mathObj?.dependsOn ?? [];

          for (const depId of deps) {
            if (!visited.has(depId)) {
              if (mathObjects.has(depId)) {
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

        for (const id of mathObjects.keys()) {
          if (!visited.has(id)) {
            dfs(id);
          }
        }

        return cycles;
      },

      getOutdatedTranslations(): Array<{ locale: string; canonicalId: string }> {
        const outdated: Array<{ locale: string; canonicalId: string }> = [];

        for (const [canonicalId, locMap] of translations.entries()) {
          const canonicalDoc = documents.get(canonicalId);
          const canonicalSha = canonicalDoc?.sha256;

          for (const [locale, locDoc] of locMap.entries()) {
            const locRefSha = (locDoc.frontmatter?.canonicalSha256 as string | undefined) ?? locDoc.sha256;
            if (canonicalSha && locRefSha && canonicalSha !== locRefSha) {
              outdated.push({ locale, canonicalId });
            }
          }
        }

        return outdated;
      },
    };
  }

  async writeToDir(targetDir: string): Promise<string> {
    mkdirSync(targetDir, { recursive: true });

    const configContent = `import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  title: ${JSON.stringify(this.title)},
  baseUrl: ${JSON.stringify(this.baseUrl)},
  url: 'https://docs.example.com',
  locales: {
    defaultLocale: ${JSON.stringify(this.defaultLocale)},
    locales: ${JSON.stringify(this.locales)},
  },
  ...${JSON.stringify(this.config, null, 2)},
});
`;
    writeFileSync(resolve(targetDir, 'lumen.config.ts'), configContent, 'utf8');

    const docsDir = resolve(targetDir, 'docs');
    mkdirSync(docsDir, { recursive: true });

    for (const doc of this.documents.values()) {
      const docPath = resolve(docsDir, doc.filePath || `${doc.id}.pdx`);
      mkdirSync(dirname(docPath), { recursive: true });

      let frontmatterStr = '';
      if (doc.frontmatter || doc.title) {
        const fm = {
          id: doc.id,
          title: doc.title,
          ...doc.frontmatter,
        };
        frontmatterStr = `---\n${Object.entries(fm)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\n')}\n---\n\n`;
      }

      writeFileSync(docPath, frontmatterStr + doc.content, 'utf8');
    }

    return targetDir;
  }
}

export const createCorpusBuilder = (options?: CorpusBuilderOptions) => CorpusGraphBuilder.create(options);

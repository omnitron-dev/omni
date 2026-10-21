/** Research Markdown v1. Carries forward SAMPLE docs-engine's structured-document
 * approach; source locations, explicit diagnostics and isolated widgets are added.
 * Source is data: HTML and unknown syntax are retained as text, never executed. */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { TipTapDoc, TipTapNode, TipTapMark } from '../tiptap-renderer/index.js';

type Position = { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
type Ast = { type: string; children?: Ast[]; position?: Position; [key: string]: unknown };
export interface ResearchDiagnostic { code: string; line: number; }
export interface ResearchDocumentData {
  format: 'prism-research/1';
  doc: TipTapDoc;
  headings: { id: string; title: string; level: number }[];
  diagnostics: ResearchDiagnostic[];
}
export const researchLimits = { source: 262144, nodes: 20000, depth: 64, block: 20000 } as const;
const str = (v: unknown) => typeof v === 'string' ? v : '';
const plain = (n: Ast): string => str(n.value) || (n.children ?? []).map(plain).join('');

export function parseResearchMarkdown(source: string, prefix = 'research'): ResearchDocumentData {
  if (source.length > researchLimits.source) throw new Error('document_limit');
  if (!/^[a-zA-Z][\w-]{0,100}$/.test(prefix)) throw new Error('invalid_document_prefix');
  const tree = fromMarkdown(source, {
    extensions: [gfm(), directive(), math()],
    mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown(), mathFromMarkdown()],
  }) as unknown as Ast;
  const headings: ResearchDocumentData['headings'] = [], diagnostics: ResearchDiagnostic[] = [];
  const ids = new Set<string>();
  let count = 0;
  const definitions = new Map<string, Ast>();
  const collect = (n: Ast, depth: number) => {
    if (++count > researchLimits.nodes || depth > researchLimits.depth) throw new Error('structure_limit');
    if (n.type === 'definition') definitions.set(str(n.identifier), n);
    for (const c of n.children ?? []) collect(c, depth + 1);
  };
  collect(tree, 0);
  const fallback = (n: Ast, code: string, inline = false): TipTapNode => {
    diagnostics.push({ code, line: n.position?.start.line ?? 1 });
    const raw = source.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0) || plain(n);
    return inline ? { type: 'text', text: raw } : { type: 'codeBlock', content: [{ type: 'text', text: raw }] };
  };
  const convert = (n: Ast, marks: TipTapMark[] = []): TipTapNode[] => {
    const children = () => (n.children ?? []).flatMap(c => convert(c, marks));
    const node = (type: string, attrs?: Record<string, unknown>, content = children()): TipTapNode[] => [{
      type, attrs: { ...attrs, source: n.position }, content,
    }];
    switch (n.type) {
      case 'root': return children();
      case 'definition': return [];
      case 'text': return [{ type: 'text', text: str(n.value), marks }];
      case 'inlineCode': return [{ type: 'text', text: str(n.value), marks: [...marks, { type: 'code' }] }];
      case 'strong': case 'emphasis': case 'delete':
        return (n.children ?? []).flatMap(c => convert(c, [...marks, { type: {strong:'bold',emphasis:'italic',delete:'strike'}[n.type]! }]));
      case 'paragraph': return node('paragraph');
      case 'heading': {
        const title = plain(n), base = `${prefix}-${title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section'}`;
        let id = base, suffix = 1;
        while (ids.has(id)) id = `${base}-${++suffix}`;
        ids.add(id); headings.push({ id, title, level: Number(n.depth) });
        return node('heading', { level: n.depth, id });
      }
      case 'linkReference': case 'imageReference': {
        const def = definitions.get(str(n.identifier));
        if (!def) return [fallback(n, 'unresolved_reference', true)];
        return convert({ ...n, type: n.type === 'linkReference' ? 'link' : 'image', url: def.url, title: def.title }, marks);
      }
      case 'link': return (n.children ?? []).flatMap(c => convert(c, [...marks, { type: 'link', attrs: { href: str(n.url) } }]));
      case 'image': return node('image', { src: str(n.url), alt: str(n.alt), title: str(n.title) }, []);
      case 'break': return node('hardBreak', {}, []);
      case 'blockquote': return node('blockquote');
      case 'thematicBreak': return node('horizontalRule', {}, []);
      case 'list': return node((n.children ?? []).some(c=>typeof c.checked==='boolean') ? 'taskList' : n.ordered ? 'orderedList':'bulletList', { start: n.start });
      case 'listItem': return node(typeof n.checked==='boolean' ? 'taskItem':'listItem', { checked: n.checked });
      case 'table': return node('table', {}, (n.children ?? []).map((row,i)=>({ type:'tableRow', content:(row.children ?? []).map(cell=>({ type:i===0?'tableHeader':'tableCell', content:[{type:'paragraph',content:(cell.children ?? []).flatMap(c=>convert(c))}] })) })));
      case 'inlineMath': case 'math': return node(n.type==='math'?'mathBlock':'mathInline', { tex: str(n.value) }, []);
      case 'code': {
        const language = str(n.lang).toLowerCase(), body = str(n.value);
        if (['mermaid','pintora','prism'].includes(language) && body.length > researchLimits.block) return [fallback(n,'block_limit')];
        if (language==='mermaid' || language==='pintora') return node('diagram', { engine: language, code: body }, []);
        if (language==='prism') {
          try { return node('researchWidget', { descriptor: JSON.parse(body) }, []); }
          catch { return [fallback(n,'invalid_widget_json')]; }
        }
        return node('codeBlock', { language, title: str(n.meta) }, [{type:'text',text:body}]);
      }
      case 'containerDirective': case 'leafDirective': {
        const name = str(n.name), attrs = (n.attributes ?? {}) as Record<string, string>;
        if (['note','tip','warning','danger','info','caution'].includes(name)) return node('admonition', { kind: name, title: attrs.title || name });
        if (name==='tabs') {
          if((n.children ?? []).some(c=>c.type!=='containerDirective' || c.name!=='tab')) return [fallback(n,'invalid_tabs')];
          return node('tabs',{},(n.children ?? []).flatMap(c=>convert(c)));
        }
        if (name==='tab') return node('tabItem', { label: attrs.label || attrs.value || 'Tab' });
        if (name==='widget') return node('researchWidget', { descriptor: { type:attrs.type, version:Number(attrs.version || 1), props:Object.fromEntries(Object.entries(attrs).filter(([key])=>key!=='type' && key!=='version')) } }, []);
        return [fallback(n,'unknown_directive')];
      }
      case 'html': return [fallback(n,'raw_html',true)];
      default: return [fallback(n,`unsupported_${n.type}`, n.type.startsWith('inline') || n.type==='textDirective' || n.type==='footnoteReference')];
    }
  };
  return { format:'prism-research/1', doc:{type:'doc',content:convert(tree)}, headings, diagnostics };
}

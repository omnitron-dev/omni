import { expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createAuthoringFixture, hash } from '../../../packages/titan-lumen/tests/authoring-fixture.js';
import { asUser, createLumenFixture } from '../../../packages/titan-lumen/tests/netron-fixture.js';
import { researchExtensions } from '../../../packages/prism/src/components/research-editor/extensions.js';
import { hydrateSource, snapshot } from '../../../packages/prism/src/components/research-editor/source.js';

it('edits only an authorized original source through the real Prism schema and native revision CAS', async () => {
  const scientificSource = [
    ':::theorem{access="confidential" title="Private proof"}',
    'PRIVATE_SCIENCE_BYTES remain part of the authorized original.',
    ':::',
    '',
    '```mermaid',
    'flowchart LR',
    'A[Original] --> B[Unchanged]',
    '```',
  ].join('\r\n');
  const original = [
    '---', 'title: Editable original', 'access: public', '---', '', '# Original edition', '',
    'Paragraph **outer *[nested mark](https://example.org/source)*** and $x^2$.', '',
    '7. First item', '8. Second item', '',
    '| Column A | Column B |', '| --- | --- |', '| First cell | Second cell |', '',
    scientificSource, '', '',
  ].join('\r\n');
  const storage = await createAuthoringFixture();
  const service = createLumenFixture({ 'paper.md': original }, { liveEdit: storage.options }, storage.live);
  const reader = await asUser(service, 'reader');
  const partialWriter = await asUser(service, 'editor');
  expect(await partialWriter.getDocument('paper.md')).not.toContain('PRIVATE_SCIENCE_BYTES');
  await expect(reader.getEditableDocument('paper.md')).rejects.toMatchObject({ code: 403 });
  await expect(partialWriter.getEditableDocument('paper.md')).rejects.toMatchObject({ code: 403 });

  const author = await asUser(service, 'admin');
  const edition = await author.getEditableDocument('paper.md');
  expect(edition).toMatchObject({ docId: 'paper.md', content: original, revision: 0, hash: hash(original) });
  if (!edition) throw new Error('Authorized original source was not returned');

  // This is the schema and source adapter used by ResearchEditor.initialSource.
  // No renderer-only JSON or replacement editor schema participates in the test.
  const schema = getSchema(researchExtensions());
  const document = schema.nodeFromJSON(hydrateSource(edition.content, schema));
  document.check();
  const nodes: ProseMirrorNode[] = [];
  document.descendants(node => { nodes.push(node); });
  const styled = nodes.find(node => node.isText && node.text === 'nested mark');
  expect(styled?.marks.map(mark => mark.type.name).sort()).toEqual(['bold', 'italic', 'link']);
  expect(styled?.marks.find(mark => mark.type.name === 'link')?.attrs['href']).toBe('https://example.org/source');
  expect(nodes.find(node => node.type.name === 'orderedList')?.attrs['start']).toBe(7);
  const cells = nodes.filter(node => node.type.name === 'tableCell' || node.type.name === 'tableHeader');
  expect(cells).toHaveLength(4);
  for (const cell of cells) {
    expect(cell.childCount).toBe(1);
    expect(cell.firstChild?.type.name).toBe('paragraph');
  }
  expect(nodes.some(node => node.type.name === 'researchSource' && String(node.attrs['raw']).includes('PRIVATE_SCIENCE_BYTES'))).toBe(true);
  const unchanged = snapshot(document).getSource();
  expect(Buffer.from(unchanged)).toEqual(Buffer.from(original));
  expect(hash(unchanged)).toBe(edition.hash);

  let editPosition: number | undefined;
  document.descendants((node, position) => {
    if (node.isText && node.text?.startsWith('Paragraph ')) editPosition = position;
  });
  if (editPosition === undefined) throw new Error('Editable paragraph was not present in the schema');
  const state = EditorState.create({ schema, doc: document });
  const edited = state.apply(state.tr.insertText('Edited ', editPosition));
  edited.doc.check();
  const patch = snapshot(edited.doc).getSource();
  expect(patch).toContain('Edited Paragraph ');
  expect(patch).toContain(scientificSource);
  const payload = { docId: edition.docId, mode: 'replace' as const, patch, baseRevision: edition.revision, baseHash: edition.hash };
  await expect(partialWriter.saveLiveEdit(payload)).rejects.toMatchObject({ code: 403 });
  expect(await storage.live.getDocument('paper.md')).toBeUndefined();
  expect(await author.saveLiveEdit(payload)).toMatchObject({ success: true, revision: 1, hash: hash(patch) });
  expect(await author.saveLiveEdit({ ...payload, patch: 'STALE_OVERWRITE' })).toMatchObject({ success: false, conflict: true, revision: 1 });
  expect(await author.getEditableDocument('paper.md')).toMatchObject({ content: patch, revision: 1, hash: hash(patch) });
});

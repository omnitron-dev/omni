import { fromMarkdown } from 'mdast-util-from-markdown';
import { releaseCommand } from '@xec-sh/ops/release';

function headingText(node) {
  return node.value ?? (node.children ?? []).map(headingText).join('');
}

/** Read the authored release section and any Markdown reference definitions it uses. */
export function changelogSection(source, version) {
  const nodes = fromMarkdown(source).children;
  const isHeading = node => node.type === 'heading' && node.depth === 2;
  const sections = nodes.filter(node => isHeading(node) &&
    [version, '[' + version + ']'].includes(headingText(node).trim().split(/\s+/, 1)[0]));
  if (sections.length > 1) throw new Error('Duplicate changelog section for ' + version);
  if (!sections.length) return '';
  const following = nodes.slice(nodes.indexOf(sections[0]) + 1);
  const next = following.findIndex(isHeading);
  const content = following.slice(0, next < 0 ? following.length : next).filter(node => node.type !== 'definition');
  const references = new Set();
  function collect(node) {
    if (node.type === 'linkReference' || node.type === 'imageReference') references.add(node.identifier);
    node.children?.forEach(collect);
  }
  content.forEach(collect);
  const definitions = nodes.filter(node => node.type === 'definition' && references.delete(node.identifier));
  return [...content, ...definitions].map(node =>
    source.slice(node.position.start.offset, node.position.end.offset)).join('\n\n');
}

/** Preparation and GitHub publication both read the same immutable source blob. */
export async function projectReleaseNotes(root, prepared, repository) {
  const { commit, version, artifacts } = prepared;
  const base = 'https://github.com/' + repository;
  const present = await releaseCommand(root, 'git', ['ls-tree', '--name-only', commit, '--', 'CHANGELOG.md']);
  const body = present ? changelogSection(await releaseCommand(root, 'git', ['show', commit + ':CHANGELOG.md']), version) : '';
  const source = '[' + commit.slice(0, 8) + '](' + base + '/tree/' + commit + ')';
  const link = present ? ' · [Changelog](' + base + '/blob/' + commit + '/CHANGELOG.md)' : '';
  const summary = artifacts.length + ' public packages · ' + source + link + '\n';
  const notes = body ? body + '\n\n' + summary : summary;
  // GitHub limits a release body to 125,000 characters. Keep the complete source reachable.
  return Buffer.byteLength(notes, 'utf8') <= 125_000 ? notes : summary;
}

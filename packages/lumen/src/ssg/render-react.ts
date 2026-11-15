import React, { type ComponentProps } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime, type ExtraProps } from 'hast-util-to-jsx-runtime';
import { toHtmlTree, type LumenDocumentAst, type SsrOptions } from '@omnitron-dev/lumen-ast';
import { getIslandComponent, type IslandRegistry } from '@omnitron-dev/lumen-ui';
import { ComponentExample } from '@omnitron-dev/lumen-ui/blocks';

/** React adapts the compiler's HTML tree; document semantics and sanitization stay in AST. */
export function renderDocumentContent(
  ast: LumenDocumentAst,
  options: SsrOptions & { islands?: IslandRegistry } = {},
): React.ReactNode {
  function island(tag: 'div' | 'span', { node, children, ...props }: React.HTMLAttributes<HTMLElement> & ExtraProps) {
    const metadata = node?.data?.lumen;
    const Component = metadata?.kind === 'widget' && options.islands
      ? getIslandComponent(options.islands, metadata.name)
      : undefined;
    return React.createElement(tag, props,
      Component && metadata?.kind === 'widget' ? React.createElement(Component, metadata.props) : children);
  }

  function Example({ node, children, ...props }: ComponentProps<'section'> & ExtraProps) {
    const metadata = node?.data?.lumen;
    if (metadata?.kind !== 'example') return React.createElement('section', props, children);
    const { id: _id, ...source } = metadata.source;
    // The compiler emits the island first and a native source disclosure second.
    // ComponentExample owns that disclosure for React without rendering it twice.
    return React.createElement('section', props,
      React.createElement(ComponentExample, { ...source, children: React.Children.toArray(children)[0] }));
  }

  // No JavaScript evaluator or document-controlled component map is supplied.
  return toJsxRuntime(toHtmlTree(ast, options), {
    Fragment, jsx, jsxs, passNode: true,
    components: { div: props => island('div', props), span: props => island('span', props), section: Example },
  }) as React.ReactNode;
}

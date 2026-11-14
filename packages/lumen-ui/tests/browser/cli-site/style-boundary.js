import { createElement } from 'react';
import { StatCard } from '@omnitron-dev/prism/components/card';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button } from '@omnitron-dev/prism/ui';
import { CodeBlock } from '@omnitron-dev/lumen-ui/blocks';

export default function StyleBoundary() {
  return createElement(Box, null,
    createElement(StatCard, { label: 'Requests', value: '42', color: 'primary' }),
    createElement(Button, { component: 'a', href: '#style-boundary-document', 'data-owned-link': true }, 'Prism link'),
    createElement(Accordion, { defaultExpanded: true },
      createElement(AccordionSummary, null, 'Source code'),
      createElement(AccordionDetails, null, createElement(CodeBlock, { code: 'const requests = 42;' }))));
}

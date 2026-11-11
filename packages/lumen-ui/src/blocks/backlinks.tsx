import React from 'react';
import clsx from 'clsx';

export interface BacklinksSectionProps {
  backlinks?: string[];
  className?: string;
}

export function BacklinksSection({ backlinks = [], className }: BacklinksSectionProps): React.JSX.Element {
  return React.createElement(
    'section',
    { className: clsx('lumen-backlinks', className) },
    React.createElement('h4', null, 'Backlinks'),
    React.createElement('ul', null, ...backlinks.map((link) => React.createElement('li', { key: link }, link)))
  );
}

import React from 'react';
import { ApiExplorer } from '@omnitron-dev/lumen-ui';
import './lazy-api.css';

export default function LazyApi() {
  return <div className="cli-lazy-api"><ApiExplorer symbols={[
    { name: 'TokenService', kind: 'class', module: 'tokens' },
    { name: 'DocumentService', kind: 'class', module: 'documents' },
  ]} /></div>;
}

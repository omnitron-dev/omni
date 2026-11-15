import { memo, useState } from 'react';
import { useIsClient } from '@omnitron-dev/prism/core';
import { Button, useTheme } from '@omnitron-dev/prism/ui';
import literalSource from './counter-example.js?raw';
import './ssr-preview.css';

export default memo(function SharedPreview() {
  const theme = useTheme();
  const interactive = useIsClient();
  const [count, setCount] = useState(0);
  return <Button variant="contained" disabled={!interactive} data-cli-preview data-mode={theme.palette.mode}
    data-source-loaded={literalSource.includes('function CounterExample') ? 'yes' : 'no'}
    sx={{ minHeight: 52, borderRadius: '13px' }} onClick={() => setCount(value => value + 1)}>
    Shared preview {count}
  </Button>;
});

import { useState } from 'react';

if (typeof window === 'undefined') throw new Error('Example module was executed during static rendering');

export default function SourceExample() {
  const [value, setValue] = useState(0);
  return <button type="button" onClick={() => setValue(current => current + 1)}>Observed {value}</button>;
}

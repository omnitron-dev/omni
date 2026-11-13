import { createElement, useState } from 'react';

export default function CounterExample() {
  const [count, setCount] = useState(0);
  return createElement('button', { type: 'button', onClick: () => setCount(value => value + 1) }, `Count ${count}`);
}

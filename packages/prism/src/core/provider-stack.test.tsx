import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { composeProviders, createProviderStack, ProviderStack } from './provider-stack.js';

function Region({ name, children }: { name: string; children: ReactNode }) {
  return <section aria-label={name}>{children}</section>;
}

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(value => value + 1)}>{count}</button>;
}

it('preserves descendants when an inline provider list receives new props', () => {
  const tree = (name: string) => <ProviderStack providers={[[Region, { name }]]}><Counter /></ProviderStack>;
  const view = render(tree('Before'));
  const button = screen.getByRole('button');
  fireEvent.click(button);
  view.rerender(tree('After'));
  expect(screen.getByRole('region', { name: 'After' })).toContainElement(button);
  expect(button).toHaveTextContent('1');
});

it('checks required props and composes stacks in declaration order', () => {
  const Inner = composeProviders([[Region, { name: 'Inner' }]]);
  const Stack = createProviderStack([[Region, { name: 'Outer' }]])({ append: [Inner] });
  render(<Stack>Content</Stack>);
  expect(screen.getByRole('region', { name: 'Outer' })).toContainElement(screen.getByRole('region', { name: 'Inner' }));
  // @ts-expect-error Region requires its name.
  composeProviders([[Region, {}]]);
  // @ts-expect-error Region accepts a string name.
  composeProviders([[Region, { name: 42 }]]);
});

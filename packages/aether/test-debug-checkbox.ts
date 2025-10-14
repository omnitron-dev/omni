/**
 * Debug script for Checkbox issue
 */
import { signal } from './src/core/reactivity/signal.js';
import { Checkbox, CheckboxIndicator } from './src/primitives/Checkbox.js';

// Test Case from failing test
const checked = signal<boolean | 'indeterminate'>(false);

console.log('Creating CheckboxIndicator...');
const indicator = CheckboxIndicator({ class: 'indicator', forceMount: true });
console.log('Indicator type:', typeof indicator);
console.log('Indicator instanceof Node:', indicator instanceof Node);
console.log('Indicator:', indicator);

console.log('\nCreating Checkbox with indicator as children...');
const checkbox = Checkbox({
  checked,
  children: indicator,
});
console.log('Checkbox result type:', typeof checkbox);
console.log('Checkbox result:', checkbox);

if (checkbox instanceof Node) {
  console.log('\nCheckbox DOM structure:');
  console.log('Tag:', (checkbox as Element).tagName);
  console.log('Children count:', checkbox.childNodes.length);
  console.log('Children:', Array.from(checkbox.childNodes).map(n => ({
    type: n.nodeType,
    name: n.nodeName,
    class: (n as any).className
  })));

  console.log('\nSearching for .indicator...');
  const found = (checkbox as Element).querySelector('.indicator');
  console.log('Found:', found);
}

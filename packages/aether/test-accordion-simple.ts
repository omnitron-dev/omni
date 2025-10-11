/**
 * Simple test to debug Accordion issue
 */

import { JSDOM } from 'jsdom';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './src/primitives/Accordion.js';

// Setup DOM
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document as any;
global.window = dom.window as any;

// Create simple accordion
const accordion = Accordion({
  type: 'single',
  defaultValue: 'item1',
  children: [
    AccordionItem({
      value: 'item1',
      children: [
        AccordionTrigger({ children: 'Item 1' }),
        AccordionContent({ children: 'Content 1' }),
      ],
    }),
  ],
});

// Mount to DOM
document.body.appendChild(accordion);

// Check results
const trigger = document.querySelector('[role="button"]') as HTMLElement;
console.log('\n=== Trigger Element ===');
console.log('aria-expanded:', trigger?.getAttribute('aria-expanded'));
console.log('data-state:', trigger?.getAttribute('data-state'));
console.log('id:', trigger?.getAttribute('id'));
console.log('aria-controls:', trigger?.getAttribute('aria-controls'));

const content = document.querySelector('[role="region"]') as HTMLElement;
console.log('\n=== Content Element ===');
console.log('content:', content?.textContent);
console.log('id:', content?.getAttribute('id'));
console.log('data-state:', content?.getAttribute('data-state'));
console.log('hidden:', content?.hasAttribute('hidden'));

const itemDiv = trigger?.parentElement as HTMLElement;
console.log('\n=== Item Div ===');
console.log('data-state:', itemDiv?.getAttribute('data-state'));

console.log('\n=== Expected ===');
console.log('aria-expanded should be "true"');
console.log('content should be visible (not hidden)');
console.log('data-state should be "open"');

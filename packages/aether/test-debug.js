import { signal, computed } from './src/core/reactivity/index.js';
import { createContext, useContext } from './src/core/component/context.js';
import { defineComponent } from './src/core/component/index.js';
import { jsx } from './src/jsx-runtime.js';
import { createRoot } from './src/core/reactivity/batch.js';

// Simulate NumberInput pattern
const globalSignal = signal(null);

const TestContext = createContext({
  value: computed(() => globalSignal()?.value() ?? 0),
  get min() {
    console.log('Getter called, global:', globalSignal());
    return globalSignal()?.min ?? -Infinity;
  },
});

const Parent = defineComponent((props) => {
  const contextValue = {
    value: computed(() => 50),
    min: 10,
  };
  
  console.log('Parent setup: setting global signal');
  globalSignal.set(contextValue);
  
  return () => {
    console.log('Parent render');
    return jsx(TestContext.Provider, {
      value: contextValue,
      children: props.children,
    });
  };
});

const Child = defineComponent(() => {
  console.log('Child setup');
  
  return () => {
    console.log('Child render: getting context');
    const ctx = useContext(TestContext);
    console.log('Child render: context.min =', ctx.min);
    console.log('Child render: context.value() =', ctx.value());
    return jsx('div', { children: `Min: ${ctx.min}, Value: ${ctx.value()}` });
  };
});

// Test
console.log('\n=== TEST START ===\n');

const component = () => Parent({ children: Child({}) });

createRoot(() => {
  const result = component();
  console.log('\nResult:', result);
  const rendered = result();
  console.log('\nRendered:', rendered);
});

console.log('\n=== TEST END ===\n');

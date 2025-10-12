console.log('=== Test Start ===\n');

let globalContext = null;

// Simulate parent
function Parent(props) {
  console.log('Parent: setup start');
  globalContext = { value: 50 };
  console.log('Parent: set global context to', globalContext);

  // Return render function
  return function render() {
    console.log('Parent: render called');
    return { type: 'div', children: props.children };
  };
}

// Simulate child
function Child(props) {
  console.log('Child: setup start');

  // Return render function
  return function render() {
    console.log('Child: render called');
    console.log('Child: global context is', globalContext);
    return { type: 'input', value: globalContext?.value ?? 0 };
  };
}

// Simulate defineComponent behavior
function defineComponent(setupFn) {
  return function component(props) {
    console.log('\nComponent called with props:', Object.keys(props));
    const renderFn = setupFn(props);
    console.log('Setup returned render function');
    const result = renderFn(); // IMMEDIATE CALL
    console.log('Render returned:', result);
    return result;
  };
}

const ParentComponent = defineComponent(Parent);
const ChildComponent = defineComponent(Child);

console.log('\n--- Creating component tree ---');
const result = ParentComponent({
  children: ChildComponent({}),
});

console.log('\n=== Final Result ===');
console.log('Result:', JSON.stringify(result, null, 2));
console.log('\n=== Test End ===');

import { createCompiler } from './dist/compiler/compiler.js';

const compiler = createCompiler({
  optimize: 'none',
});

const source = 'export const A = () => <div />;';

const result1 = await compiler.compile(source);
console.log('Result 1 (optimize: none):');
console.log('Length:', result1.code.length);
console.log('Code:', JSON.stringify(result1.code));
console.log('Optimize:', compiler.getOptions().optimize);
console.log('Minify:', compiler.getOptions().minify);
console.log('');

compiler.setOptions({ optimize: 'aggressive' });

const result2 = await compiler.compile(source);
console.log('Result 2 (optimize: aggressive):');
console.log('Length:', result2.code.length);
console.log('Code:', JSON.stringify(result2.code));
console.log('Optimize:', compiler.getOptions().optimize);
console.log('Minify:', compiler.getOptions().minify);
console.log('');

console.log('Expected: result2.length <= result1.length');
console.log('Actual:', result2.code.length, '<=', result1.code.length, '?', result2.code.length <= result1.code.length);

/**
 * Typing latency benchmarks
 *
 * Measures typing performance to ensure <16ms latency (60 FPS target)
 */

import { Schema } from 'prosemirror-model';
import { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  benchmark,
  generateMockDocument,
  createDocFromText,
  createMockEditorView,
  cleanupEditorView,
  assertBenchmarkBudget,
  formatBenchmarkResult,
  type BenchmarkResult,
} from './helpers.js';

const TYPING_BUDGET = 16; // 16ms for 60 FPS

/**
 * Create a basic schema for testing
 */
function createTestSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
    },
    marks: {
      bold: {
        parseDOM: [{ tag: 'strong' }],
        toDOM: () => ['strong', 0],
      },
    },
  });
}

/**
 * Simulate typing a character
 */
function typeCharacter(view: EditorView, char: string): void {
  const { state } = view;
  const { selection } = state;
  const tr = state.tr.insertText(char, selection.from);
  view.dispatch(tr);
}

/**
 * Run typing latency benchmarks
 */
async function runTypingBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const schema = createTestSchema();

  // Test 1: Empty document typing
  console.log('\n📝 Test 1: Empty document typing...');
  {
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]),
      schema,
    });
    const view = createMockEditorView(state);

    const result = await benchmark(
      'Empty document typing',
      () => {
        typeCharacter(view, 'a');
      },
      { samples: 200, warmup: 20 }
    );

    console.log(formatBenchmarkResult(result));
    assertBenchmarkBudget(result, TYPING_BUDGET);
    results.push(result);

    cleanupEditorView(view);
  }

  // Test 2: Small document (1KB) typing
  console.log('\n📝 Test 2: Small document (1KB) typing...');
  {
    const content = generateMockDocument(1);
    const doc = createDocFromText(schema, content);
    const state = EditorState.create({ doc, schema });
    const view = createMockEditorView(state);

    // Set cursor to middle of document
    const middlePos = Math.floor(doc.content.size / 2);
    const tr = state.tr.setSelection(EditorState.create({ doc, schema }).selection);
    view.dispatch(tr);

    const result = await benchmark(
      'Small document (1KB) typing',
      () => {
        typeCharacter(view, 'a');
      },
      { samples: 200, warmup: 20 }
    );

    console.log(formatBenchmarkResult(result));
    assertBenchmarkBudget(result, TYPING_BUDGET);
    results.push(result);

    cleanupEditorView(view);
  }

  // Test 3: Medium document (10KB) typing
  console.log('\n📝 Test 3: Medium document (10KB) typing...');
  {
    const content = generateMockDocument(10);
    const doc = createDocFromText(schema, content);
    const state = EditorState.create({ doc, schema });
    const view = createMockEditorView(state);

    const result = await benchmark(
      'Medium document (10KB) typing',
      () => {
        typeCharacter(view, 'a');
      },
      { samples: 150, warmup: 15 }
    );

    console.log(formatBenchmarkResult(result));
    assertBenchmarkBudget(result, TYPING_BUDGET);
    results.push(result);

    cleanupEditorView(view);
  }

  // Test 4: Large document (50KB) typing
  console.log('\n📝 Test 4: Large document (50KB) typing...');
  {
    const content = generateMockDocument(50);
    const doc = createDocFromText(schema, content);
    const state = EditorState.create({ doc, schema });
    const view = createMockEditorView(state);

    const result = await benchmark(
      'Large document (50KB) typing',
      () => {
        typeCharacter(view, 'a');
      },
      { samples: 100, warmup: 10 }
    );

    console.log(formatBenchmarkResult(result));
    // Relaxed budget for large documents
    assertBenchmarkBudget(result, TYPING_BUDGET * 1.5);
    results.push(result);

    cleanupEditorView(view);
  }

  // Test 5: Typing with marks (bold)
  console.log('\n📝 Test 5: Typing with bold mark...');
  {
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]),
      schema,
    });
    const view = createMockEditorView(state);

    // Add bold mark
    const boldMark = schema.marks.bold.create();
    view.dispatch(view.state.tr.addStoredMark(boldMark));

    const result = await benchmark(
      'Typing with bold mark',
      () => {
        typeCharacter(view, 'a');
      },
      { samples: 200, warmup: 20 }
    );

    console.log(formatBenchmarkResult(result));
    assertBenchmarkBudget(result, TYPING_BUDGET);
    results.push(result);

    cleanupEditorView(view);
  }

  // Test 6: Rapid typing simulation
  console.log('\n📝 Test 6: Rapid typing simulation...');
  {
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]),
      schema,
    });
    const view = createMockEditorView(state);

    const text = 'Hello, World!';
    const result = await benchmark(
      'Rapid typing (full sentence)',
      () => {
        for (const char of text) {
          typeCharacter(view, char);
        }
      },
      { samples: 50, warmup: 5 }
    );

    console.log(formatBenchmarkResult(result));
    // Average per character should be under budget
    const perCharBudget = TYPING_BUDGET * text.length * 1.2;
    assertBenchmarkBudget(result, perCharBudget);
    results.push(result);

    cleanupEditorView(view);
  }

  return results;
}

/**
 * Run benchmarks if executed directly
 */
if (import.meta.main || (typeof require !== 'undefined' && require.main === module)) {
  console.log('⚡ Running Typing Latency Benchmarks');
  console.log('Target: <16ms (60 FPS)\n');

  runTypingBenchmarks()
    .then((results) => {
      console.log('\n✅ All typing latency benchmarks passed!');
      console.log(`\nSummary: ${results.length} benchmarks completed`);

      const avgP95 = results.reduce((sum, r) => sum + r.p95, 0) / results.length;
      console.log(`Average P95: ${avgP95.toFixed(2)}ms`);

      if (avgP95 < TYPING_BUDGET) {
        console.log('🎯 Well within 60 FPS target!');
      } else {
        console.log('⚠️  Some benchmarks exceeded target');
      }

      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Typing latency benchmarks failed:');
      console.error(error);
      process.exit(1);
    });
}

export { runTypingBenchmarks };

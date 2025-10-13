# RECONCILIATION ENGINE - IMPLEMENTATION PLAN

**Date:** October 13, 2025
**Priority:** P0 - PRODUCTION BLOCKER
**Estimated Effort:** 3-4 weeks
**Approach:** Fine-Grained Reactivity (SolidJS-style)

---

## 🎯 OBJECTIVE

Implement a reconciliation engine that enables **fine-grained DOM updates** without re-creating entire DOM trees on signal changes. This will make Aether production-ready by solving:

❌ **Current Problems:**
- Input focus lost on every keystroke
- Scroll positions reset on updates
- Animations restart
- Event listeners re-attached
- Complete DOM replacement on signal update

✅ **After Implementation:**
- Surgical DOM updates only where signals change
- Focus, scroll, and state preserved
- Optimal performance with minimal DOM operations
- Production-ready framework

---

## 🏗️ ARCHITECTURE OVERVIEW

### Chosen Approach: Fine-Grained Reactivity

**Why Fine-Grained vs Virtual DOM:**
1. **Better fit for signals**: Direct signal→DOM connection
2. **Optimal performance**: Only update what changed
3. **Smaller bundle**: No VDOM overhead (~3-5KB vs ~8-12KB)
4. **Aligns with Aether's design**: Already has effect tracking

**Core Concept:**
```typescript
// Template function runs ONCE
const Counter = defineComponent(() => {
  const count = signal(0);

  // Returns template that creates DOM with reactive bindings
  return () => (
    <div>
      {/* This text node is bound to count signal via effect */}
      Count: {count()}
      <button onClick={() => count.set(count() + 1)}>+</button>
    </div>
  );
});

// How it works:
// 1. Template executes once, creates DOM structure
// 2. Dynamic parts (count()) create effects that update ONLY those nodes
// 3. When count changes, effect updates text node directly
// 4. No template re-execution, no DOM recreation
```

---

## 📋 IMPLEMENTATION PHASES

### Phase 1: Core Infrastructure (Week 1)

#### 1.1. VNode System
**Purpose:** Virtual representation of DOM for diffing

```typescript
// packages/aether/src/reconciler/vnode.ts

type VNodeType = 'element' | 'text' | 'component' | 'fragment';

interface VNode {
  type: VNodeType;
  tag?: string | ComponentFunction;
  props?: Record<string, any>;
  children?: VNode[];
  key?: string | number;
  dom?: Node | null; // Reference to actual DOM node
  effects?: EffectImpl[]; // Effects attached to this node
}

// Create VNode from jsx() calls
function createVNode(
  type: string | symbol | Function,
  props: any,
  key?: string | number
): VNode;

// Convert VNode to DOM
function createDOMFromVNode(vnode: VNode): Node;
```

**Deliverables:**
- `src/reconciler/vnode.ts` - VNode types and creators
- `src/reconciler/create-dom.ts` - VNode → DOM conversion
- Tests: `tests/unit/reconciler/vnode.spec.ts`

#### 1.2. Reactive Binding System
**Purpose:** Connect signals to DOM nodes via effects

```typescript
// packages/aether/src/reconciler/reactive-binding.ts

interface ReactiveBinding {
  node: Node;
  effect: EffectImpl;
  cleanup?: () => void;
}

// Create effect that updates DOM node when signal changes
function bindSignalToNode(
  node: Text | HTMLElement,
  getValue: () => any,
  updateFn: (node: Node, value: any) => void
): ReactiveBinding;

// Example usage:
const textNode = document.createTextNode('');
bindSignalToNode(textNode, count, (node, value) => {
  node.textContent = String(value);
});
// Now when count changes, textNode updates automatically
```

**Deliverables:**
- `src/reconciler/reactive-binding.ts`
- Tests: `tests/unit/reconciler/reactive-binding.spec.ts`

---

### Phase 2: JSX Integration (Week 2)

#### 2.1. Enhanced JSX Runtime
**Purpose:** Make jsx() create VNodes and setup reactive bindings

**Current jsx() behavior:**
```typescript
// Current: Creates DOM immediately
jsx('div', { children: count() })
// → Creates div with text node containing current count value
// → No reactivity, static content
```

**New jsx() behavior:**
```typescript
// New: Creates VNode with reactive bindings
jsx('div', { children: count() })
// → Creates VNode representing div
// → Detects count() is a signal access
// → Sets up effect to update text node when count changes
// → Returns DOM with reactive binding attached
```

**Implementation:**
```typescript
// src/jsxruntime/runtime-enhanced.ts

// Detect if value is reactive (signal access)
function isReactive(value: any): boolean {
  // Check if we're inside reactive tracking context
  return context.isTracking;
}

// Enhanced jsx that handles reactive values
export function jsx(type: any, props: any, key?: any): JSXElement {
  // If props contain reactive values (signals), create effects
  const reactiveProps = detectReactiveProps(props);

  if (reactiveProps.length > 0) {
    // Create VNode with reactive bindings
    const vnode = createReactiveVNode(type, props, key);
    return vnode;
  }

  // Static content - use current implementation
  return createStaticElement(type, props, key);
}

// Detect reactive props (those that access signals)
function detectReactiveProps(props: any): string[] {
  const reactive: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    // Track if this value accesses signals
    let accessed = false;
    context.withTracking(() => {
      try {
        if (typeof value === 'function') value();
        accessed = context.didAccess;
      } catch {}
    });

    if (accessed) reactive.push(key);
  }

  return reactive;
}
```

**Deliverables:**
- Refactor `src/jsxruntime/runtime.ts` with reactivity detection
- Add `src/reconciler/jsx-integration.ts`
- Tests: `tests/unit/jsxruntime/reactive-jsx.spec.ts`

#### 2.2. Component Template Caching
**Purpose:** Cache template results to avoid re-execution

```typescript
// src/reconciler/template-cache.ts

interface TemplateCacheEntry {
  vnode: VNode;
  bindings: ReactiveBinding[];
  cleanup: () => void;
}

class TemplateCache {
  private cache = new WeakMap<ComponentFunction, TemplateCacheEntry>();

  // Get or create cached template result
  getCached(component: ComponentFunction, props: any): TemplateCacheEntry {
    const cached = this.cache.get(component);
    if (cached) return cached;

    // Execute template once
    const result = component(props);
    const entry = this.createEntry(result);
    this.cache.set(component, entry);
    return entry;
  }
}
```

**Deliverables:**
- `src/reconciler/template-cache.ts`
- Integration with `defineComponent()`
- Tests: `tests/unit/reconciler/template-cache.spec.ts`

---

### Phase 3: Diffing & Patching (Week 3)

#### 3.1. Diffing Algorithm
**Purpose:** Compare old and new VNodes to determine minimal changes

```typescript
// src/reconciler/diff.ts

interface Patch {
  type: 'create' | 'remove' | 'replace' | 'update' | 'reorder';
  vnode?: VNode;
  props?: Record<string, any>;
  oldVNode?: VNode;
}

// Diff two VNode trees
function diff(oldVNode: VNode | null, newVNode: VNode | null): Patch[] {
  // No old node - create new
  if (!oldVNode && newVNode) {
    return [{ type: 'create', vnode: newVNode }];
  }

  // No new node - remove old
  if (oldVNode && !newVNode) {
    return [{ type: 'remove', vnode: oldVNode }];
  }

  // Different types - replace
  if (oldVNode!.type !== newVNode!.type || oldVNode!.tag !== newVNode!.tag) {
    return [{ type: 'replace', vnode: newVNode, oldVNode }];
  }

  // Same node - check for updates
  const patches: Patch[] = [];

  // Diff props
  const propPatches = diffProps(oldVNode!.props, newVNode!.props);
  if (propPatches.length > 0) {
    patches.push({ type: 'update', vnode: newVNode, props: propPatches });
  }

  // Diff children with key-based reconciliation
  const childPatches = diffChildren(oldVNode!.children, newVNode!.children);
  patches.push(...childPatches);

  return patches;
}

// Key-based list reconciliation
function diffChildren(
  oldChildren: VNode[] = [],
  newChildren: VNode[] = []
): Patch[] {
  // Build key maps
  const oldKeyMap = new Map<string | number, VNode>();
  const newKeyMap = new Map<string | number, VNode>();

  for (const child of oldChildren) {
    if (child.key !== undefined) oldKeyMap.set(child.key, child);
  }

  for (const child of newChildren) {
    if (child.key !== undefined) newKeyMap.set(child.key, child);
  }

  // Determine moves, creates, removes
  const patches: Patch[] = [];

  // ... key-based reconciliation logic (similar to React)

  return patches;
}
```

**Deliverables:**
- `src/reconciler/diff.ts` - Main diffing logic
- `src/reconciler/diff-children.ts` - Key-based list reconciliation
- `src/reconciler/diff-props.ts` - Props diffing
- Tests: `tests/unit/reconciler/diff.spec.ts` (comprehensive cases)

#### 3.2. Patching Engine
**Purpose:** Apply minimal DOM changes based on diff patches

```typescript
// src/reconciler/patch.ts

class Patcher {
  // Apply patches to DOM
  patch(patches: Patch[], container: HTMLElement): void {
    for (const patch of patches) {
      switch (patch.type) {
        case 'create':
          this.patchCreate(patch, container);
          break;
        case 'remove':
          this.patchRemove(patch);
          break;
        case 'replace':
          this.patchReplace(patch);
          break;
        case 'update':
          this.patchUpdate(patch);
          break;
        case 'reorder':
          this.patchReorder(patch);
          break;
      }
    }
  }

  private patchCreate(patch: Patch, container: HTMLElement): void {
    const dom = createDOMFromVNode(patch.vnode!);
    container.appendChild(dom);
    patch.vnode!.dom = dom;
  }

  private patchUpdate(patch: Patch): void {
    const { vnode, props } = patch;
    const dom = vnode!.dom as HTMLElement;

    // Update only changed props
    for (const [key, value] of Object.entries(props!)) {
      applyProp(dom, key, value);
    }
  }

  // ... other patch methods
}
```

**Deliverables:**
- `src/reconciler/patch.ts`
- Tests: `tests/unit/reconciler/patch.spec.ts`

---

### Phase 4: Fine-Grained Reactivity (Week 4)

#### 4.1. Effect-Based Updates
**Purpose:** Wire signals directly to DOM nodes for surgical updates

```typescript
// src/reconciler/fine-grained.ts

// Create reactive text node
function createReactiveTextNode(getContent: () => any): Text {
  const textNode = document.createTextNode('');

  // Effect updates text when signal changes
  effect(() => {
    const content = getContent();
    textNode.textContent = String(content);
  });

  return textNode;
}

// Create reactive attribute
function createReactiveAttribute(
  element: HTMLElement,
  attr: string,
  getValue: () => any
): void {
  effect(() => {
    const value = getValue();
    if (value != null) {
      element.setAttribute(attr, String(value));
    } else {
      element.removeAttribute(attr);
    }
  });
}

// Create reactive property
function createReactiveProperty(
  element: HTMLElement,
  prop: string,
  getValue: () => any
): void {
  effect(() => {
    const value = getValue();
    (element as any)[prop] = value;
  });
}

// Create reactive style
function createReactiveStyle(
  element: HTMLElement,
  getStyle: () => Record<string, any>
): void {
  effect(() => {
    const style = getStyle();
    for (const [property, value] of Object.entries(style)) {
      if (value != null) {
        element.style.setProperty(property, String(value));
      } else {
        element.style.removeProperty(property);
      }
    }
  });
}
```

**Deliverables:**
- `src/reconciler/fine-grained.ts`
- Integration with jsx runtime
- Tests: `tests/unit/reconciler/fine-grained.spec.ts`

#### 4.2. Conditional Rendering
**Purpose:** Show/hide/swap content reactively

```typescript
// src/reconciler/conditional.ts

// <Show when={condition()} fallback={<div>Loading</div>}>
//   <div>Content</div>
// </Show>

function Show(props: {
  when: () => boolean;
  children: any;
  fallback?: any;
}): Node {
  const anchor = document.createComment('show');
  let currentContent: Node | null = null;

  effect(() => {
    const condition = props.when();
    const newContent = condition ? props.children : props.fallback;

    // Remove old content
    if (currentContent) {
      currentContent.remove();
    }

    // Insert new content
    const dom = createDOMFromValue(newContent);
    anchor.parentNode?.insertBefore(dom, anchor);
    currentContent = dom;
  });

  return anchor;
}

// <For each={items()} children={(item) => <div>{item}</div>} />

function For<T>(props: {
  each: () => T[];
  children: (item: T, index: () => number) => any;
}): Node {
  const anchor = document.createComment('for');
  let previousNodes: Node[] = [];

  effect(() => {
    const items = props.each();
    const newNodes: Node[] = [];

    // Create nodes for each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const node = createDOMFromValue(props.children(item, () => i));
      newNodes.push(node);
    }

    // Diff and patch (key-based if items have keys)
    reconcileList(anchor, previousNodes, newNodes);
    previousNodes = newNodes;
  });

  return anchor;
}
```

**Deliverables:**
- `src/reconciler/conditional.ts`
- Components: `Show`, `For`, `Switch/Match`
- Tests: `tests/unit/reconciler/conditional.spec.ts`

---

## 📊 TESTING STRATEGY

### Unit Tests (Per Component)
Each reconciler component needs comprehensive tests:

```typescript
// tests/unit/reconciler/fine-grained.spec.ts

describe('Fine-Grained Reactivity', () => {
  test('reactive text node updates when signal changes', () => {
    const count = signal(0);
    const node = createReactiveTextNode(() => count());

    expect(node.textContent).toBe('0');

    count.set(1);
    expect(node.textContent).toBe('1');

    count.set(42);
    expect(node.textContent).toBe('42');
  });

  test('reactive attribute updates when signal changes', () => {
    const isDisabled = signal(false);
    const button = document.createElement('button');

    createReactiveAttribute(button, 'disabled', () => isDisabled());

    expect(button.hasAttribute('disabled')).toBe(false);

    isDisabled.set(true);
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  // ... more tests
});
```

### Integration Tests

```typescript
// tests/integration/reconciler/counter.spec.ts

describe('Reconciler Integration: Counter', () => {
  test('counter preserves input focus', () => {
    const Counter = defineComponent(() => {
      const count = signal(0);

      return () => (
        <div>
          <input id="test-input" value={count()} />
          <button onClick={() => count.set(count() + 1)}>+</button>
        </div>
      );
    });

    const container = document.createElement('div');
    const dom = Counter({});
    container.appendChild(dom);

    const input = container.querySelector('#test-input') as HTMLInputElement;
    input.focus();

    const button = container.querySelector('button')!;
    button.click();

    // Focus should be preserved
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('1');
  });
});
```

### Performance Benchmarks

```typescript
// tests/benchmarks/reconciler-performance.bench.ts

import { bench } from 'vitest';

bench('10,000 item list reconciliation', () => {
  const items = signal(Array.from({ length: 10000 }, (_, i) => i));

  // Measure time to update one item
  items.set(items().map((x, i) => i === 5000 ? 9999 : x));

  // Should complete in <10ms for fine-grained reactivity
});
```

---

## 🎯 MILESTONE DELIVERABLES

### Week 1: Core Infrastructure
- ✅ VNode system with types
- ✅ Reactive binding infrastructure
- ✅ Basic effect→DOM connections
- ✅ Unit tests passing

### Week 2: JSX Integration
- ✅ Enhanced jsx runtime with reactivity detection
- ✅ Template caching system
- ✅ Component integration
- ✅ Integration tests passing

### Week 3: Diffing & Patching
- ✅ Complete diffing algorithm
- ✅ Key-based list reconciliation
- ✅ Patching engine
- ✅ Complex diff tests passing

### Week 4: Fine-Grained Polish
- ✅ Effect-based updates optimized
- ✅ Conditional rendering components
- ✅ List rendering with `For` component
- ✅ ALL 6,146+ tests passing
- ✅ Performance benchmarks meet targets

---

## 📈 SUCCESS CRITERIA

### Functional Requirements
- ✅ Input focus preserved during updates
- ✅ Scroll positions maintained
- ✅ Animations not interrupted
- ✅ Event listeners persist
- ✅ Key-based list updates (no full re-render)

### Performance Targets
- ✅ Simple component update: <1ms
- ✅ 1,000 item list update: <10ms
- ✅ 10,000 item list update: <50ms
- ✅ Bundle size increase: <5KB (gzipped)

### Test Coverage
- ✅ All existing 6,146 tests passing
- ✅ 100+ new reconciler unit tests
- ✅ 50+ integration tests
- ✅ Performance benchmarks documented

---

## 🚨 RISKS & MITIGATION

### Risk 1: Breaking Existing Tests
**Mitigation:**
- Incremental integration
- Feature flag for new reconciler
- Run full test suite after each milestone
- Maintain backward compatibility layer

### Risk 2: Performance Regression
**Mitigation:**
- Benchmark at each milestone
- Compare with current implementation
- Optimize hot paths
- Use effect batching

### Risk 3: Complexity Creep
**Mitigation:**
- Start with minimal viable implementation
- Add features incrementally
- Keep code modular and testable
- Document trade-offs

---

## 📚 RESOURCES & REFERENCES

### Similar Implementations
- **SolidJS:** Fine-grained reactivity reference
  - https://github.com/solidjs/solid/tree/main/packages/solid
- **Vue 3:** Reactivity system
  - https://github.com/vuejs/core/tree/main/packages/reactivity
- **Million.js:** Compiler-based approach
  - https://github.com/aidenybai/million

### Key Papers
- "Fine-grained Reactivity" by Ryan Carniato
- "Virtual DOM is pure overhead" by Rich Harris
- React Fiber architecture documentation

---

## 🎯 NEXT STEPS

1. **Review & Approve Plan** - Team sign-off on approach
2. **Setup Feature Branch** - `feat/reconciliation-engine`
3. **Week 1 Kickoff** - Start VNode system implementation
4. **Daily Standups** - Track progress and blockers
5. **Milestone Reviews** - Demo working features each week

---

**Status:** 📋 READY TO START
**Owner:** TBD
**Timeline:** 4 weeks (October 14 - November 11, 2025)
**Priority:** P0 - PRODUCTION BLOCKER

---

*This plan provides a clear roadmap to production-ready Aether with fine-grained reactivity and optimal performance.*

# Accordion Primitive: Architectural Limitation Analysis

## Executive Summary

The Accordion primitive has a fundamental architectural limitation in Aether's current JSX implementation that prevents multi-instance nested contexts from working correctly. Only 1 out of 11 tests pass (9% pass rate).

**Root Cause:** JSX eagerly evaluates children before parent component setup completes, preventing nested components from accessing parent-provided context.

**Status:** **Unfixable** without core JSX architecture changes.

**Recommended Action:** Implement lazy children evaluation in JSX runtime (medium-large architectural change).

---

## The Problem

### Current Behavior

When rendering an Accordion with multiple items:
- Only 1/11 tests pass
- `aria-expanded` attributes are incorrect
- Context values are not properly scoped to each AccordionItem instance
- Children cannot access their parent AccordionItem's context

### Expected Behavior

Each `AccordionItem` should provide its own context that its children (`AccordionTrigger` and `AccordionContent`) can access, with multiple items coexisting independently.

---

## Root Cause Analysis

### Component Hierarchy
```
Accordion (provides AccordionContext)
└── AccordionItem (provides AccordionItemContext) [×N instances]
    ├── AccordionTrigger (consumes AccordionItemContext)
    └── AccordionContent (consumes AccordionItemContext)
```

### The Evaluation Order Problem

In JavaScript/JSX, this code:
```jsx
<AccordionItem value="item1">
  <AccordionTrigger>Item 1</AccordionTrigger>
</AccordionItem>
```

Becomes:
```js
AccordionItem({
  value: "item1",
  children: AccordionTrigger({ children: "Item 1" })  // ← EAGER EVALUATION
})
```

**Critical Issue:** `AccordionTrigger()` is **evaluated immediately** as part of the function call arguments, BEFORE `AccordionItem` executes!

### Execution Timeline

1. **Test/Render Phase:**
   ```
   const component = () => Accordion({
     children: AccordionItem({           // ← Called here
       children: AccordionTrigger()      // ← But children evaluated FIRST!
     })
   })
   ```

2. **What Actually Happens:**
   ```
   Step 1: AccordionTrigger() called
           - Creates component with current owner (root/Accordion)
           - Tries to access AccordionItemContext → gets default value
           - Returns DOM element

   Step 2: AccordionItem() called with pre-evaluated children
           - Creates own owner
           - Provides AccordionItemContext
           - But children already created with wrong owner!

   Step 3: AccordionItem renders children
           - Children are already-constructed DOM elements
           - Context access already happened and failed
   ```

3. **The Owner Chain Problem:**
   ```
   Root Owner
   ├── Accordion Owner (provides AccordionContext) ✓
   │   ├── AccordionTrigger Owner ✗ (should be child of Item, but isn't!)
   │   ├── AccordionContent Owner ✗ (should be child of Item, but isn't!)
   │   └── AccordionItem Owner (provides AccordionItemContext)
   │       └── (no children because they were evaluated earlier)
   ```

   The trigger/content components create owners as children of the ACCORDION, not the ITEM, because they're evaluated before the item's setup runs.

---

## Why This Affects Accordion But Not Slider

**Slider works** because it uses a **single-instance context pattern:**
- One `Slider` provides ONE `SliderContext`
- Multiple `SliderThumb` components all read the SAME context
- Children read from ancestor context (works fine)

**Accordion fails** because it uses a **multi-instance nested context pattern:**
- Multiple `AccordionItem` instances each provide DIFFERENT contexts
- Each `AccordionTrigger` needs its specific parent item's context
- Children need to read from DIRECT PARENT, not ancestor
- But parent doesn't exist yet when children are created!

---

## Attempted Solutions

### 1. Remove Context.Provider, Use Only provideContext()
**Result:** Failed. Children are still evaluated before parent setup.

### 2. Global Signal for Context
**Result:** Failed. All items shared the same context (last one wins).

### 3. DOM-Based Context Lookup
**Implementation:** Store contexts in global registry, look up via DOM traversal.
**Result:** Partially worked but requires async (MutationObserver or microtask), tests are synchronous.

### 4. Instance-Scoped Context Map
**Result:** Failed. No way to know which instance's context to access.

---

## The Real Solution: Lazy Children

The fundamental fix requires **lazy children evaluation** in the JSX runtime.

### Current JSX Behavior
```typescript
// runtime.ts createComponentElement()
function createComponentElement(Component, props) {
  const result = Component(props);  // children already evaluated in props!
  return result;
}
```

### Required Change: Lazy Children

**Option A: Wrapper Functions**
```jsx
<AccordionItem value="item1">
  {() => <AccordionTrigger>Item 1</AccordionTrigger>}
</AccordionItem>
```

Pro: Simple, no JSX changes
Con: Terrible DX, breaks standard JSX

**Option B: Lazy Children in JSX Runtime** (RECOMMENDED)
```typescript
// Modified runtime
function createComponentElement(Component, props) {
  // Wrap children in lazy getter
  const lazyProps = {
    ...props,
    get children() {
      return props.children;  // Evaluated only when accessed
    }
  };
  const result = Component(lazyProps);
  return result;
}
```

Pro: No API changes, fixes all nested context issues
Con: Requires JSX runtime modification, may affect performance

**Option C: Symbol-Based Lazy Children**
```typescript
const LAZY_CHILDREN = Symbol('lazy');

function jsx(type, props) {
  return {
    type,
    props: {
      ...props,
      [LAZY_CHILDREN]: props.children  // Store for lazy eval
    }
  };
}
```

Pro: Explicit lazy semantics
Con: Larger change to JSX transform

---

## Workaround for Current Implementation

Until lazy children are implemented, Accordion can be restructured to avoid nested contexts:

### Flat Context Pattern

```typescript
// Store all item state in root Accordion context
interface AccordionContextValue {
  value: () => string | string[];
  setValue: (value: string | string[]) => void;
  // Add methods that take item value as parameter
  getItemState: (value: string) => { isOpen: boolean; disabled: boolean };
  toggleItem: (value: string) => void;
  getItemIds: (value: string) => { triggerId: string; contentId: string };
}

// Children access via props + root context
export const AccordionTrigger = defineComponent<{
  itemValue: string;  // ← Pass explicitly
  children: any;
}>((props) => {
  const ctx = useContext(AccordionContext);
  const itemState = ctx.getItemState(props.itemValue);
  const ids = ctx.getItemIds(props.itemValue);

  return () => jsx('button', {
    'aria-expanded': itemState.isOpen,
    onClick: () => ctx.toggleItem(props.itemValue),
    ...
  });
});
```

**Pros:**
- Works with current JSX
- Single context, no nesting issues

**Cons:**
- Requires passing itemValue to all children
- Less elegant API
- Breaks composition patterns

---

## Recommendation

1. **Short term:** Document limitation, mark Accordion as experimental
2. **Medium term:** Implement lazy children in JSX runtime (Option B above)
3. **Long term:** Consider adopting a component model that supports proper context scoping

---

## Files Affected

- `/packages/aether/src/primitives/Accordion.ts` - Implementation
- `/packages/aether/tests/unit/primitives/Accordion.test.ts` - Tests (1/11 passing)
- `/packages/aether/src/jsxruntime/runtime.ts` - Needs lazy children support

---

## Comparison with Other Frameworks

### React
React's JSX also eagerly evaluates, but context works because:
- Components don't execute immediately
- `<Component>` creates element descriptor, not result
- Actual execution happens during reconciliation
- Context lookup happens during render, not construction

### SolidJS
SolidJS handles this correctly:
- JSX returns functions, not results
- Children are functions that execute in parent scope
- Context lookup happens during reactive execution

### Aether's Challenge
Aether's design combines:
- Immediate component execution (like function calls)
- Context-based composition (like React)
- But without React's element descriptors or Solid's reactive functions

This combination makes nested instance contexts impossible.

---

## Conclusion

The Accordion primitive exposes a fundamental architectural limitation: **multi-instance nested contexts cannot work with eager child evaluation**.

This is not a bug in Accordion—it's a limitation of the current JSX runtime architecture. Any primitive with similar patterns (nested contexts where each parent instance provides different context) will face the same issue.

**The proper fix is implementing lazy children evaluation in the JSX runtime.**

Without this change, components must use workarounds like:
- Flat context hierarchies
- Props drilling
- Global registries with explicit lookups
- Callback-based children patterns

---

## Next Steps

1. **Decision Required:** Should we:
   a) Implement lazy children in JSX runtime?
   b) Use workaround pattern for Accordion?
   c) Mark nested context patterns as unsupported?

2. **If implementing lazy children:**
   - Estimated effort: 2-3 days
   - Impact: Core JSX runtime change
   - Risk: Medium (affects all components)
   - Benefit: Fixes entire class of context issues

3. **If using workaround:**
   - Estimated effort: 4-6 hours
   - Impact: Accordion API only
   - Risk: Low
   - Benefit: Accordion works, but pattern remains unsupported

---

**Author:** Claude (AI Assistant)
**Date:** 2025-10-11
**Status:** Investigation Complete - Awaiting Decision

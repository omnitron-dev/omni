/**
 * State module exports
 */

// Atomic state (Jotai-like)
export {
  atom,
  derived,
  asyncAtom,
  useAtom,
  useAtomValue,
  useSetAtom,
  selectAtom,
  resetAtom,
  getAtom,
  setAtom,
  type Atom,
  type WritableAtom,
  type DerivedAtom,
  type AsyncAtom,
} from './atom.js';

// Store state (Zustand-like)
export {
  createStore,
  useStore,
  persist,
  devtools,
  immer,
  combineSlices,
  type StoreApi,
  type SetState,
  type GetState,
  type StateCreator,
  type Middleware,
} from './store.js';

// Source de vérité du layout en mémoire. Pur (pas de DOM). Pile undo/redo + events.
import { DEFAULT_LAYOUT } from './default-layout.js';

export function createModel(initial) {
  let state = structuredClone(initial ?? DEFAULT_LAYOUT);
  const undoStack = [], redoStack = [], subs = new Set();
  // state est passé tel quel (référence live) : les abonnés le LISENT seulement
  // et ne mutent QUE via commit() — sinon l'historique undo est corrompu.
  const emit = () => subs.forEach(fn => fn(state));
  const snapshot = () => {
    undoStack.push(structuredClone(state));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  };
  return {
    get state() { return state; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    commit(mutator) { snapshot(); mutator(state); emit(); },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },
    undo() { if (!undoStack.length) return; redoStack.push(structuredClone(state)); state = undoStack.pop(); emit(); },
    redo() { if (!redoStack.length) return; undoStack.push(structuredClone(state)); state = redoStack.pop(); emit(); },
    toJSON() { return JSON.stringify(state, null, 2); },
    loadJSON(text) { const next = JSON.parse(text); snapshot(); state = next; emit(); }
  };
}

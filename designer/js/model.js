// Source de vérité du layout en mémoire. Pur (pas de DOM). Pile undo/redo + events.
import { DEFAULT_LAYOUT } from './default-layout.js';

export function createModel(initial) {
  let state = structuredClone(initial ?? DEFAULT_LAYOUT);
  const undoStack = [], redoStack = [], subs = new Set();
  let lastCoalesce = null;   // clé de coalescence d'undo du dernier commit (cf. designer F2)
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
    // Coalescence d'undo : des commits successifs portant la même clé `opts.coalesce` (ex. flèches /
    // spinner d'un même champ numérique) fusionnent en UNE entrée d'undo (pas de nouveau snapshot).
    // Tout commit sans clé — ou de clé différente — repart sur une entrée neuve ; breakCoalesce()
    // force la coupure (appelé au blur du champ, cf. inspector F2).
    commit(mutator, opts) {
      const key = opts && opts.coalesce != null ? opts.coalesce : null;
      if (key !== null && key === lastCoalesce && undoStack.length) { mutator(state); emit(); }
      else { snapshot(); mutator(state); emit(); }
      lastCoalesce = key;
    },
    breakCoalesce() { lastCoalesce = null; },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },
    undo() { if (!undoStack.length) return; lastCoalesce = null; redoStack.push(structuredClone(state)); state = undoStack.pop(); emit(); },
    redo() { if (!redoStack.length) return; lastCoalesce = null; undoStack.push(structuredClone(state)); state = redoStack.pop(); emit(); },
    toJSON() { return JSON.stringify(state, null, 2); },
    loadJSON(text) { const next = JSON.parse(text); lastCoalesce = null; snapshot(); state = next; emit(); }
  };
}

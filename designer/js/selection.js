// Source de vérité de la sélection courante du designer, partagée entre l'arbre des calques, le canvas et
// l'inspecteur. Pur (pas de DOM). Une sélection est l'un de :
//   { kind: 'doc' }                       → le nœud Document (params globaux)
//   { kind: 'page', page }                → une page (index dans pages[])
//   { kind: 'comp', page, index }         → un placement (index dans pages[page].place[])
//   null                                  → rien de sélectionné
// (cf. spec 2026-06-21-designer-refonte-ihm-design.md §1/§2).

// Égalité structurelle de deux sélections (ou null). Sert à éviter les emits redondants du store et à
// décider si l'inspecteur doit re-render.
export function sameSelection(a, b) {
  if (a === b) return true;          // même réf, ou null === null
  if (!a || !b) return false;        // l'un seulement est null
  if (a.kind !== b.kind) return false;
  if (a.kind === 'page') return a.page === b.page;
  if (a.kind === 'comp') return a.page === b.page && a.index === b.index;
  return true;                       // 'doc' (pas d'autre champ discriminant)
}

// Store de sélection : même forme que createModel (subscribe rend un désabonnement). Émet uniquement quand
// la sélection change réellement (sameSelection court-circuite les set redondants → pas de re-render inutile,
// invariant clé pour l'inspecteur).
export function createSelection(initial = null) {
  let cur = initial;
  const subs = new Set();
  const emit = () => subs.forEach(fn => fn(cur));
  const api = {
    // get() est une méthode (≠ le getter-propriété `get state()` de model.js) : la sélection est un
    // scalaire à lire, pas un objet d'état composite — l'appel explicite est plus clair au point d'usage.
    get() { return cur; },
    set(next) { if (sameSelection(cur, next)) return; cur = next; emit(); },
    clear() { api.set(null); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  return api;
}

// La sélection pointe-t-elle encore quelque chose d'existant dans `state` ? Utilisé à l'intégration pour
// purger une sélection périmée après suppression / undo / import (sinon l'inspecteur édite dans le vide).
export function isSelectionValid(state, sel) {
  if (!sel) return false;
  if (sel.kind === 'doc') return true;
  const page = state.pages?.[sel.page];
  if (!page) return false;
  if (sel.kind === 'page') return true;
  return !!page.place?.[sel.index];   // 'comp'
}

// L'index de placement à surligner sur le canvas pour la sélection courante : `index` si la sélection est
// un composant sur la page affichée (`activePage`), sinon null (doc/page/null, ou composant d'une AUTRE
// page). Pur — le canvas s'en sert dans applySelection. Le test « index 0 » garde le piège du falsy.
export function placementSelection(sel, activePage) {
  if (!sel || sel.kind !== 'comp' || sel.page !== activePage) return null;
  return sel.index;
}

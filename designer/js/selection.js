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
    get() { return cur; },
    set(next) { if (sameSelection(cur, next)) return; cur = next; emit(); },
    clear() { api.set(null); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  return api;
}

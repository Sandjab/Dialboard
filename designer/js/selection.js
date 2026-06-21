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

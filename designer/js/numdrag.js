// Valeur d'un champ numerique sous glisser-horizontal : 1px = 1 unite (x10 avec Shift), delta arrondi.
// Pur (teste node) ; le DOM est dans inspector.js (attachNumDrag).
export function numDragValue(startVal, dxPx, shift) {
  const base = Number.isFinite(startVal) ? startVal : 0;
  const step = shift ? 10 : 1;
  return base + Math.round(dxPx) * step;
}

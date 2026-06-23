// Carousel de vignettes de pages (sous le hero disque) : navigation visuelle rapide.
// Vue de plus sur le modèle (abonnée model + selection), comme l'arbre/canvas.
// La math/décisions pures sont ici (testées node) ; le rendu DOM est vérifié au navigateur.

import { COMPONENTS } from './registry.js';
import { placeAt, SCREEN } from './geometry.js';
import { getMock } from './mocks.js';

// Miroir de src/config.h:3 (#define MAX_PAGES 8) et de designer/js/validate.js:27 (LIM.pages).
export const MAX_PAGES = 8;

// Peut-on encore ajouter une page ? (borne le bouton « + page »)
export function canAddPage(state, max = MAX_PAGES) {
  return (state?.pages?.length ?? 0) < max;
}

// État des flèches de défilement selon la position de scroll de la bande.
// Tolérance d'1px pour absorber les arrondis sub-pixel de scrollWidth/clientWidth.
export function arrowState({ scrollLeft, scrollWidth, clientWidth }) {
  return {
    left: scrollLeft > 0,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

// Rend une page entière en read-only dans un mini-stage 360×360 (mêmes builders + placement que le
// canvas, sans sélection/poignées/preview). L'appelant (carousel) attache l'élément au DOM puis le
// scale (transform) à la taille de la vignette. Composants `physical` ignorés (cf. canvas.render).
// DOIT être attaché au DOM avant lecture des tailles : le placement non-centré mesure le widget.
export function buildPageStatic(page, comps) {
  const mini = document.createElement('div');
  mini.className = 'mini-stage';
  mini.style.width = SCREEN + 'px';
  mini.style.height = SCREEN + 'px';
  mini.style.position = 'relative';
  const place = page?.place ?? [];
  // Phase 1 : construire + attacher (pour pouvoir mesurer).
  const built = [];
  for (const pl of place) {
    const comp = comps?.[pl.ref];
    if (!comp) continue;                 // ref inconnue : la validation le signale déjà
    const def = COMPONENTS[comp.type];
    if (!def || def.physical) continue;  // type inconnu / sortie physique : pas dessiné sur une page
    const node = def.build(comp, pl, getMock(pl.ref, comp.type));
    mini.appendChild(node);
    built.push({ node, pl, def });
  }
  // Phase 2 : positionner (mesure à l'échelle 1, le carousel scale le conteneur ensuite).
  for (const { node, pl, def } of built) {
    if (def.centered) {
      const r = pl.radius || 80;
      node.style.left = (SCREEN / 2 - r) + 'px';
      node.style.top  = (SCREEN / 2 - r) + 'px';
    } else {
      const rect = node.getBoundingClientRect();
      const { x, y } = placeAt(pl.anchor || 'CENTER', pl.dx || 0, pl.dy || 0, rect.width, rect.height);
      node.style.left = x + 'px';
      node.style.top  = y + 'px';
    }
  }
  return mini;
}

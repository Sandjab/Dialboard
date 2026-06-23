// Carousel de vignettes de pages (sous le hero disque) : navigation visuelle rapide.
// Vue de plus sur le modèle (abonnée model + selection), comme l'arbre/canvas.
// La math/décisions pures sont ici (testées node) ; le rendu DOM est vérifié au navigateur.

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

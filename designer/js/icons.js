// Jeu d'icônes monochromes des types de composants (palette). Vue uniquement — hors registry.js
// (qui reste la source de vérité logique). Trait = `currentColor` → les icônes héritent de la
// couleur du texte/thème ; un seul jeu, aucun asset binaire (tient l'usage offline/flash).
//
// Style commun : viewBox 24, trait 2, bouts/jointures ronds. Silhouettes choisies pour rester
// distinctes à ~16px. `fill="currentColor"` est posé localement sur les éléments pleins (points
// LED, remplissage de barre, moyeu de jauge) — le reste est en contour.
const PATHS = {
  label:    '<path d="M6 6h12M12 6v12"/>',                                   // « T » typographique
  readout:  '<rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M8 12h8"/>', // valeur sur un afficheur
  bar:      '<rect x="3" y="10" width="18" height="4" rx="2"/><rect x="3" y="10" width="10" height="4" rx="2" fill="currentColor" stroke="none"/>', // barre de progression
  ring:     '<path d="M6.2 17.8a8 8 0 1 1 11.6 0"/>',                        // anneau ouvert (gap en bas, comme le device)
  chart:    '<path d="M4 16l5-5 4 3 7-7"/>',                                 // courbe
  meter:    '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-4"/><circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none"/>', // demi-jauge + aiguille
  led:      '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>', // point plein + halo
  image:    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="9.5" r="1.5"/><path d="M20 15l-4-4-9 8"/>', // cadre + soleil + paysage
  image_anim:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/>', // même cadre + lecture (play)
  led_ring:'<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none"/>', // couronne de LED (WS2812)
  sound:    '<path d="M4 9h3l4-3v12l-4-3H4z"/><path d="M15 9a4 4 0 0 1 0 6"/>', // haut-parleur + onde
};

// Construit un <svg> namespacé via DOMParser (parse en contexte SVG, sans innerHTML).
// Contenu statique (constantes ci-dessus, jamais d'entrée externe). Élément neuf à chaque appel.
export function iconFor(type) {
  const inner = PATHS[type];
  if (!inner) return null;
  const src =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="palette-icon" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

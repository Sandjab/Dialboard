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
  rect:     '<rect x="4" y="6" width="16" height="12" rx="2"/>',
  circle:   '<circle cx="12" cy="12" r="8"/>',
  line:     '<path d="M4 12h16"/>',
  icon:     '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none"/><path d="M5 18l5-5 3 3 3-4 4 5"/>',
  state:    '<rect x="7" y="2.5" width="10" height="19" rx="4"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/>', // feu tricolore (visuel piloté par la valeur)
  switch:   '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5"/><circle cx="16" cy="12" r="2.2" fill="currentColor" stroke="none"/>', // interrupteur (poignée à droite = on)
  button:   '<rect x="4" y="7" width="16" height="10" rx="3"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',      // bouton + point de tap
  slider: '<line x1="3" y1="12" x2="21" y2="12"/>' +
          '<circle cx="14" cy="12" r="3" fill="currentColor" stroke="none"/>',
  arc:    '<path d="M4 16 A 9 9 0 1 1 20 16"/>' +
          '<circle cx="20" cy="16" r="2.2" fill="currentColor" stroke="none"/>',
  roller: '<rect x="5" y="4" width="14" height="16" rx="2"/>' +
          '<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>' +
          '<polyline points="9 7 12 5.5 15 7"/>',
  stepper: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 12h2M15 11v2M14 12h2"/>',
  segmented: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 8v8M15 8v8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  rings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M20 20v.01"/>',
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

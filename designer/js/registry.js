// Registre unique des types de composants (designer). Source de vérité côté éditeur :
// palette, défauts, géométrie initiale, champs d'inspecteur et aperçu en découlent.
// Le test de conformité (tests/registry.test.js) vérifie que ces clés == les types du schema.
// L'aperçu (build) reste dans render.js (double-maintenance du rendu firmware) ; ici on le référence
// via une signature normalisée (comp, placement, mock).
import { snapPlacement } from './geometry.js';
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed } from './render.js';

// Placement initial d'un widget d'écran : ancrage + offset déduits du point de dépôt (boîte ~0).
const screenPlacement = (id, x, y) => {
  const { anchor, dx, dy } = snapPlacement(x, y, 0, 0, 16);
  return { ref: id, anchor, dx, dy };
};

export const COMPONENTS = {
  label: {
    label: 'Label',
    defaults: () => ({ type: 'label', text: 'Texte', font: 20, color: '#FFFFFF' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['text', 'Texte', 'asciitext'], ['font', 'Police', 'font'], ['color', 'Couleur', 'color'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [],
    build: (comp) => buildLabel(comp),
  },
  readout: {
    label: 'Lecture',
    defaults: () => ({ type: 'readout', label: 'Label', font: 20, color: '#FFFFFF' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['label', 'Label', 'asciitext'], ['unit', 'Unité', 'asciitext'], ['font', 'Police', 'font'], ['color', 'Couleur', 'color'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, _pl, mock) => buildReadout(comp, mock),
  },
  bar: {
    label: 'Barre',
    defaults: () => ({ type: 'bar', label: 'Bar', min: 0, max: 100, color: '#38BDF8', label_color: '#9AA0AA', label_font: 14, label_align: 'TOP_MID' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['label', 'Label', 'asciitext'], ['min', 'Min', 'num'], ['max', 'Max', 'num'], ['color', 'Couleur', 'color'], ['label_color', 'Couleur label', 'color'], ['label_font', 'Police label', 'font'], ['label_align', 'Alignement label', 'anchorOut'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'], ['width', 'Largeur', 'num'], ['height', 'Hauteur', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildBar(comp, pl, mock),
  },
  ring: {
    label: 'Anneau',
    defaults: () => ({ type: 'ring', color: '#38BDF8', pill: true, min: 0, max: 100 }),
    makePlacement: (id) => ({ ref: id, radius: 80, thickness: 16, gap_deg: 70 }),
    centered: true, physical: false,
    compFields: [['color', 'Couleur', 'color'],
                 ['pill', 'Pastille %', 'bool', c => !c.center_pct],         // ignoré quand center_pct (prioritaire)
                 ['center_pct', 'Centre %', 'bool'],
                 ['font', 'Police centre', 'font', c => !!c.center_pct],     // dimensionne le chiffre central
                 ['center_color', 'Couleur centre', 'color', c => !!c.center_pct],
                 ['countdown', 'Countdown', 'bool'], ['min', 'Min', 'num'], ['max', 'Max', 'num'],
                 ['cap_prefix', 'Préfixe légende', 'asciitext'],
                 ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['radius', 'Rayon', 'num'], ['thickness', 'Épaisseur', 'num'], ['gap_deg', 'Ouverture°', 'num'], ['start_angle', 'Angle départ°', 'num']],
    mockFields: [['value', 'Valeur % (aperçu)'], ['reset_in_s', 'Countdown (s)']],
    build: (comp, pl, mock) => buildRing(comp, pl, mock),
  },
  chart: {
    label: 'Graphe',
    defaults: () => ({ type: 'chart', color: '#38BDF8', min: 0, max: 100, points: 30 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['min', 'Min', 'num'], ['max', 'Max', 'num'],
                 ['points', 'Points', 'num'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Largeur', 'num'], ['height', 'Hauteur', 'num']],
    mockFields: [],
    build: (comp, pl, mock) => buildChart(comp, pl, mock),
  },
  meter: {
    label: 'Jauge',
    defaults: () => ({ type: 'meter', color: '#38BDF8', min: 0, max: 100 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['min', 'Min', 'num'], ['max', 'Max', 'num'],
                 ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Largeur', 'num'], ['height', 'Hauteur', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildMeter(comp, pl, mock),
  },
  image: {
    label: 'Image',
    defaults: () => ({ type: 'image', w: 120, h: 120 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['src', 'Image', 'image']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [],
    build: (comp) => buildImage(comp),
  },
  image_anim: {
    label: 'Image animée',
    defaults: () => ({ type: 'image_anim', w: 120, h: 120, period: 100, rest_frame: 0, loop: 0, autoplay: false }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['src', 'Animation', 'image_anim'], ['period', 'Période (ms)', 'num'],
                 ['rest_frame', 'Frame repos', 'num'], ['loop', 'Boucles (0=∞)', 'num'],
                 ['autoplay', 'Autoplay', 'bool'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [],
    build: (comp) => buildImageAnim(comp),
  },
  led: {
    label: 'LED',
    defaults: () => ({ type: 'led', color: '#22C55E', off_below: 1 }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 24 }),
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['off_below', 'Éteint sous', 'num'], ['bind', 'Variable (pull)', 'asciitext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'], ['size', 'Diamètre', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildLed(comp, pl, mock),
  },
  led_ring: {
    label: 'LED ring',
    defaults: () => ({ type: 'led_ring', color: '#FFFFFF', brightness: 64 }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true, singleton: true,
    compFields: [['color', 'Couleur', 'color'], ['brightness', 'Luminosité (0-255)', 'num']],
    placeFields: [],
    mockFields: [],
    build: null,   // physique : édité dans le panneau « Device », non rendu sur le canvas
  },
  sound: {
    label: 'Son',
    defaults: () => ({ type: 'sound' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true,
    compFields: [],
    placeFields: [],
    mockFields: [],
    build: null,
  },
};

// Registre unique des types de composants (designer). Source de vérité côté éditeur :
// palette, défauts, géométrie initiale, champs d'inspecteur et aperçu en découlent.
// Le test de conformité (tests/registry.test.js) vérifie que ces clés == les types du schema.
// L'aperçu (build) reste dans render.js (double-maintenance du rendu firmware) ; ici on le référence
// via une signature normalisée (comp, placement, mock).
import { snapPlacement } from './geometry.js';
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed, buildRect, buildCircle, buildLine, buildIcon } from './render.js';

// Modes de l'anneau LED physique (value firmware → libellé FR). Partagé designer/firmware via le schéma.
export const LED_MODES = [
  ['off', 'Éteint'], ['solid', 'Plein'], ['progress', 'Progression'],
  ['spinner', 'Rotation'], ['blink', 'Clignotant'], ['breathe', 'Respiration'],
];

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
    compFields: [['text', 'Texte', 'latintext'], ['font', 'Police', 'font'], ['font_family', 'Police (famille)', 'fontfamily'], ['bold', 'Gras', 'bool'], ['italic', 'Italique', 'bool'], ['color', 'Couleur', 'color'], ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [],
    build: (comp) => buildLabel(comp),
  },
  readout: {
    label: 'Lecture',
    defaults: () => ({ type: 'readout', label: 'Label', font: 20, color: '#FFFFFF' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['label', 'Label', 'latintext'], ['unit', 'Unité', 'latintext'], ['font', 'Police', 'font'], ['font_family', 'Police (famille)', 'fontfamily'], ['bold', 'Gras', 'bool'], ['italic', 'Italique', 'bool'], ['color', 'Couleur', 'color'], ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, _pl, mock) => buildReadout(comp, mock),
  },
  bar: {
    label: 'Barre',
    defaults: () => ({ type: 'bar', label: 'Bar', min: 0, max: 100, color: '#38BDF8', label_color: '#9AA0AA', label_font: 14, label_align: 'TOP_MID' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['label', 'Label', 'latintext'], ['min', 'Min', 'num'], ['max', 'Max', 'num'], ['color', 'Couleur', 'color'], ['mode', 'Mode', 'barmode'], ['orientation', 'Orientation', 'orient'], ['anim_ms', 'Animation (ms)', 'num'], ['label_color', 'Couleur label', 'color'], ['label_font', 'Police label', 'font'], ['label_family', 'Famille label', 'fontfamily'], ['label_bold', 'Label gras', 'bool'], ['label_italic', 'Label italique', 'bool'], ['label_align', 'Alignement label', 'anchorOut'], ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'], ['width', 'Largeur', 'num', 200], ['height', 'Hauteur', 'num', 16]],  // 4e = placeholder du défaut firmware (view.cpp:184)
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildBar(comp, pl, mock),
  },
  ring: {
    label: 'Anneau',
    defaults: () => ({ type: 'ring', color: '#38BDF8', pill: true, min: 0, max: 100 }),
    makePlacement: (id) => ({ ref: id, radius: 80, thickness: 16, gap_deg: 70 }),
    centered: true, physical: false,
    compFields: [['color', 'Couleur', 'color'],
                 ['mode', 'Mode', 'arcmode'], ['rounded', 'Bouts arrondis', 'bool'],
                 ['pill', 'Pastille %', 'bool'],                             // indépendant du centre (les deux coexistent)
                 ['center_pct', 'Centre %', 'bool'],
                 ['font', 'Police centre', 'font', c => !!c.center_pct],     // dimensionne le chiffre central
                 ['font_family', 'Famille centre', 'fontfamily', c => !!c.center_pct],
                 ['bold', 'Centre gras', 'bool', c => !!c.center_pct],
                 ['italic', 'Centre italique', 'bool', c => !!c.center_pct],
                 ['center_color', 'Couleur centre', 'color', c => !!c.center_pct],
                 ['countdown', 'Countdown', 'bool'], ['min', 'Min', 'num'], ['max', 'Max', 'num'],
                 ['cap_prefix', 'Préfixe légende', 'latintext'],
                 ['bind', 'Variable (pull)', 'idtext']],
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
                 ['points', 'Points', 'num'], ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Largeur', 'num', 200], ['height', 'Hauteur', 'num', 100]],  // 4e = placeholder du défaut firmware (view.cpp:258)
    mockFields: [],
    build: (comp, pl, mock) => buildChart(comp, pl, mock),
  },
  meter: {
    label: 'Jauge',
    defaults: () => ({ type: 'meter', color: '#38BDF8', min: 0, max: 100 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['min', 'Min', 'num'], ['max', 'Max', 'num'],
                 ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Largeur', 'num', 160], ['height', 'Hauteur', 'num', 160]],  // 4e = placeholder ; défaut firmware = width (carré), 160 si tout absent (view.cpp:285)
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
                 ['autoplay', 'Autoplay', 'bool'], ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [],
    build: (comp) => buildImageAnim(comp),
  },
  led: {
    label: 'LED',
    defaults: () => ({ type: 'led', color: '#22C55E', off_below: 1, glow: true, bezel: true, specular: true, off_glass: true }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 24 }),
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['off_below', 'Éteint sous', 'num'],
                 ['glow', 'Glow', 'bool'], ['bezel', 'Bezel', 'bool'],
                 ['specular', 'Reflet', 'bool'], ['off_glass', 'Reflet éteint', 'bool', c => c.specular ?? true],
                 ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'], ['size', 'Diamètre', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, pl, mock) => buildLed(comp, pl, mock),
  },
  icon: {
    label: 'Icône',
    defaults: () => ({ type: 'icon', symbol: 'bell', color: '#FFFFFF', font: 28 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['symbol', 'Symbole', 'symbol'], ['color', 'Couleur', 'color'],
                 ['font', 'Taille', 'font'], ['bind', 'Variable (pull)', 'idtext']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num']],
    mockFields: [['value', 'Valeur (aperçu)']],
    build: (comp, _pl, mock) => buildIcon(comp, mock),
  },
  rect: {
    label: 'Rectangle',
    defaults: () => ({ type: 'rect', fill: '#38BDF8', border_width: 0, border_color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120, height: 60, radius: 0 }),
    centered: false, physical: false,
    compFields: [['fill', 'Fond', 'fill'], ['border_width', 'Épaisseur contour', 'num'],
                 ['border_color', 'Couleur contour', 'color', c => (c.border_width || 0) > 0]],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Largeur', 'num', 120], ['height', 'Hauteur', 'num', 60], ['radius', 'Rayon coin', 'num', 0]],
    mockFields: [],
    build: (comp, pl) => buildRect(comp, pl),
  },
  circle: {
    label: 'Cercle',
    defaults: () => ({ type: 'circle', fill: '#38BDF8', border_width: 0, border_color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 60 }),
    centered: false, physical: false,
    compFields: [['fill', 'Fond', 'fill'], ['border_width', 'Épaisseur contour', 'num'],
                 ['border_color', 'Couleur contour', 'color', c => (c.border_width || 0) > 0]],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['size', 'Diamètre', 'num', 60]],
    mockFields: [],
    build: (comp, pl) => buildCircle(comp, pl),
  },
  line: {
    label: 'Droite',
    defaults: () => ({ type: 'line', color: '#FFFFFF', orientation: 'horizontal', dash: 'solid', rounded: false }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120, thickness: 2 }),
    centered: false, physical: false,
    compFields: [['color', 'Couleur', 'color'], ['orientation', 'Orientation', 'orient'],
                 ['dash', 'Motif', 'dash'], ['rounded', 'Bouts arrondis', 'bool']],
    placeFields: [['anchor', 'Ancrage', 'anchor'], ['dx', 'dx', 'num'], ['dy', 'dy', 'num'],
                  ['width', 'Longueur', 'num', 120], ['thickness', 'Épaisseur', 'num', 2]],
    mockFields: [],
    build: (comp, pl) => buildLine(comp, pl),
  },
  led_ring: {
    label: 'LED ring',
    defaultId: 'led',
    defaults: () => ({ type: 'led_ring', color: '#FFFFFF', brightness: 64, mode: 'off' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true, singleton: true,   // singleton : invariant documentaire (plus lu — unicité assurée par ensurePhysicals + retrait de l'UI d'ajout)
    compFields: [
      ['color', 'Couleur', 'color'],
      ['brightness', 'Luminosité (0-255)', 'num'],
      ['mode', 'Mode', 'ledmode'],
      ['period_ms', 'Période (ms)', 'num', c => ['spinner', 'blink', 'breathe'].includes(c.mode)],
    ],
    placeFields: [],
    mockFields: [['value', 'Valeur % (aperçu)']],
    build: null,   // physique : édité dans le panneau « Device », l'aperçu passe par led-ring-preview.js
  },
  sound: {
    label: 'Son',
    defaultId: 'buzz',
    defaults: () => ({ type: 'sound' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true,
    compFields: [],
    placeFields: [],
    mockFields: [],
    build: null,
  },
};

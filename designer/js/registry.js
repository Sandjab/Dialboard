// Registre unique des types de composants (designer). Source de vérité côté éditeur :
// palette, défauts, géométrie initiale, champs d'inspecteur et aperçu en découlent.
// Le test de conformité (tests/registry.test.js) vérifie que ces clés == les types du schema.
// L'aperçu (build) reste dans render.js (double-maintenance du rendu firmware) ; ici on le référence
// via une signature normalisée (comp, placement, mock).
// i18n : les libellés (label de type, libellés de champs, LED_MODES) sont des CLÉS i18n résolues par t()
// au point d'affichage (tree/statusbar/inspector/canvas-zones). Le contenu textuel par
// défaut (default.*) est localisé À LA CRÉATION via t() — Latin-1 garanti (contrat WS-2).
import { snapPlacement } from './geometry.js';
import { t } from './i18n.js';
import { buildLabel, buildReadout, buildBar, buildRing, buildChart, buildMeter, buildImage, buildImageAnim, buildLed, buildRect, buildCircle, buildLine, buildIcon } from './render.js';

// Modes de l'anneau LED physique (value firmware → clé i18n du libellé). Partagé designer/firmware via le schéma.
export const LED_MODES = [
  ['off', 'ledmode.off'], ['solid', 'ledmode.solid'], ['progress', 'ledmode.progress'],
  ['spinner', 'ledmode.spinner'], ['blink', 'ledmode.blink'], ['breathe', 'ledmode.breathe'],
];

// Placement initial d'un widget d'écran : ancrage + offset déduits du point de dépôt (boîte ~0).
const screenPlacement = (id, x, y) => {
  const { anchor, dx, dy } = snapPlacement(x, y, 0, 0, 16);
  return { ref: id, anchor, dx, dy };
};

export const COMPONENTS = {
  label: {
    label: 'comp.label',
    defaults: () => ({ type: 'label', text: t('default.label.text'), font: 20, color: '#FFFFFF' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['text', 'field.text', 'latintext'], ['font', 'field.font', 'font'], ['font_family', 'field.font_family', 'fontfamily'], ['bold', 'field.bold', 'bool'], ['italic', 'field.italic', 'bool'], ['color', 'field.color', 'color'], ['fill', 'field.fill', 'fill'], ['border_width', 'field.border_width', 'num'], ['border_color', 'field.border_color', 'color', c => (c.border_width || 0) > 0], ['pad_x', 'field.pad_x', 'num'], ['pad_y', 'field.pad_y', 'num'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'], ['radius', 'field.radius_corner', 'num', 0]],
    mockFields: [],
    build: (comp, pl) => buildLabel(comp, pl),
  },
  readout: {
    label: 'comp.readout',
    defaults: () => ({ type: 'readout', label: t('default.readout.label'), font: 20, color: '#FFFFFF' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['label', 'field.label', 'latintext'], ['unit', 'field.unit', 'latintext'], ['font', 'field.font', 'font'], ['font_family', 'field.font_family', 'fontfamily'], ['bold', 'field.bold', 'bool'], ['italic', 'field.italic', 'bool'], ['color', 'field.color', 'color'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num']],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, _pl, mock) => buildReadout(comp, mock),
  },
  bar: {
    label: 'comp.bar',
    defaults: () => ({ type: 'bar', label: t('default.bar.label'), min: 0, max: 100, color: '#38BDF8', label_color: '#9AA0AA', label_font: 14, label_align: 'TOP_MID' }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['label', 'field.label', 'latintext'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'], ['color', 'field.color', 'color'], ['mode', 'field.mode', 'barmode'], ['orientation', 'field.orientation', 'orient'], ['anim_ms', 'field.anim_ms', 'num'], ['label_color', 'field.label_color', 'color'], ['label_font', 'field.label_font', 'font'], ['label_family', 'field.label_family', 'fontfamily'], ['label_bold', 'field.label_bold', 'bool'], ['label_italic', 'field.label_italic', 'bool'], ['label_align', 'field.label_align', 'anchorOut'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'], ['width', 'field.width', 'num', 200], ['height', 'field.height', 'num', 16]],  // 4e = placeholder du défaut firmware (view.cpp:184)
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildBar(comp, pl, mock),
  },
  ring: {
    label: 'comp.ring',
    defaults: () => ({ type: 'ring', color: '#38BDF8', min: 0, max: 100 }),
    makePlacement: (id) => ({ ref: id, radius: 80, thickness: 16, gap_deg: 70 }),
    centered: true, physical: false,
    compFields: [['color', 'field.color', 'color'],
                 ['mode', 'field.mode', 'arcmode'], ['rounded', 'field.rounded', 'bool'],
                 ['center_pct', 'field.center_pct', 'bool'],
                 ['font', 'field.font_center', 'font', c => !!c.center_pct],     // dimensionne le chiffre central
                 ['font_family', 'field.family_center', 'fontfamily', c => !!c.center_pct],
                 ['bold', 'field.bold_center', 'bool', c => !!c.center_pct],
                 ['italic', 'field.italic_center', 'bool', c => !!c.center_pct],
                 ['center_color', 'field.center_color', 'color', c => !!c.center_pct],
                 ['countdown', 'field.countdown', 'bool'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'],
                 ['cap_prefix', 'field.cap_prefix', 'latintext'],
                 ['bind', 'field.bind', 'idtext']],
    placeFields: [['radius', 'field.radius', 'num'], ['thickness', 'field.thickness', 'num'], ['gap_deg', 'field.gap_deg', 'num'], ['start_angle', 'field.start_angle', 'num']],
    mockFields: [['value', 'field.mock_pct'], ['reset_in_s', 'field.countdown_s']],
    build: (comp, pl, mock) => buildRing(comp, pl, mock),
  },
  chart: {
    label: 'comp.chart',
    defaults: () => ({ type: 'chart', color: '#38BDF8', min: 0, max: 100, points: 30 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['color', 'field.color', 'color'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'],
                 ['points', 'field.points', 'num'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 200], ['height', 'field.height', 'num', 100]],  // 4e = placeholder du défaut firmware (view.cpp:258)
    mockFields: [],
    build: (comp, pl, mock) => buildChart(comp, pl, mock),
  },
  meter: {
    label: 'comp.meter',
    defaults: () => ({ type: 'meter', color: '#38BDF8', min: 0, max: 100 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['color', 'field.color', 'color'], ['min', 'field.min', 'num'], ['max', 'field.max', 'num'],
                 ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 160], ['height', 'field.height', 'num', 160]],  // 4e = placeholder ; défaut firmware = width (carré), 160 si tout absent (view.cpp:285)
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildMeter(comp, pl, mock),
  },
  image: {
    label: 'comp.image',
    defaults: () => ({ type: 'image', w: 120, h: 120 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['src', 'field.image', 'image']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num']],
    mockFields: [],
    build: (comp) => buildImage(comp),
  },
  image_anim: {
    label: 'comp.image_anim',
    defaults: () => ({ type: 'image_anim', w: 120, h: 120, period: 100, rest_frame: 0, loop: 0, autoplay: false }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['src', 'field.animation', 'image_anim'], ['period', 'field.period', 'num'],
                 ['rest_frame', 'field.rest_frame', 'num'], ['loop', 'field.loops', 'num'],
                 ['autoplay', 'field.autoplay', 'bool'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num']],
    mockFields: [],
    build: (comp) => buildImageAnim(comp),
  },
  led: {
    label: 'comp.led',
    defaults: () => ({ type: 'led', color: '#22C55E', off_below: 1, glow: true, bezel: true, specular: true, off_glass: true }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 24 }),
    centered: false, physical: false,
    compFields: [['color', 'field.color', 'color'], ['off_below', 'field.off_below', 'num'],
                 ['glow', 'field.glow', 'bool'], ['bezel', 'field.bezel', 'bool'],
                 ['specular', 'field.specular', 'bool'], ['off_glass', 'field.off_glass', 'bool', c => c.specular ?? true],
                 ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'], ['size', 'field.size', 'num']],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, pl, mock) => buildLed(comp, pl, mock),
  },
  icon: {
    label: 'comp.icon',
    defaults: () => ({ type: 'icon', symbol: 'bell', color: '#FFFFFF', font: 28 }),
    makePlacement: screenPlacement,
    centered: false, physical: false,
    compFields: [['symbol', 'field.symbol', 'symbol'], ['color', 'field.color', 'color'],
                 ['font', 'field.font_size', 'font'], ['bind', 'field.bind', 'idtext']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num']],
    mockFields: [['value', 'field.mock_value']],
    build: (comp, _pl, mock) => buildIcon(comp, mock),
  },
  rect: {
    label: 'comp.rect',
    defaults: () => ({ type: 'rect', fill: '#38BDF8', border_width: 0, border_color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120, height: 60, radius: 0 }),
    centered: false, physical: false,
    compFields: [['fill', 'field.fill', 'fill'], ['border_width', 'field.border_width', 'num'],
                 ['border_color', 'field.border_color', 'color', c => (c.border_width || 0) > 0]],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.width', 'num', 120], ['height', 'field.height', 'num', 60], ['radius', 'field.radius_corner', 'num', 0]],
    mockFields: [],
    build: (comp, pl) => buildRect(comp, pl),
  },
  circle: {
    label: 'comp.circle',
    defaults: () => ({ type: 'circle', fill: '#38BDF8', border_width: 0, border_color: '#FFFFFF' }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), size: 60 }),
    centered: false, physical: false,
    compFields: [['fill', 'field.fill', 'fill'], ['border_width', 'field.border_width', 'num'],
                 ['border_color', 'field.border_color', 'color', c => (c.border_width || 0) > 0]],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['size', 'field.size', 'num', 60]],
    mockFields: [],
    build: (comp, pl) => buildCircle(comp, pl),
  },
  line: {
    label: 'comp.line',
    defaults: () => ({ type: 'line', color: '#FFFFFF', orientation: 'horizontal', dash: 'solid', rounded: false }),
    makePlacement: (id, x, y) => ({ ...screenPlacement(id, x, y), width: 120, thickness: 2 }),
    centered: false, physical: false,
    compFields: [['color', 'field.color', 'color'], ['orientation', 'field.orientation', 'orient'],
                 ['dash', 'field.dash', 'dash'], ['rounded', 'field.rounded', 'bool']],
    placeFields: [['anchor', 'field.anchor', 'anchor'], ['dx', 'field.dx', 'num'], ['dy', 'field.dy', 'num'],
                  ['width', 'field.length', 'num', 120], ['thickness', 'field.thickness', 'num', 2]],
    mockFields: [],
    build: (comp, pl) => buildLine(comp, pl),
  },
  led_ring: {
    label: 'comp.led_ring',
    defaultId: 'led',
    defaults: () => ({ type: 'led_ring', color: '#FFFFFF', brightness: 64, mode: 'off' }),
    makePlacement: (id) => ({ ref: id }),
    centered: false, physical: true, singleton: true,   // singleton : invariant documentaire (plus lu — unicité assurée par ensurePhysicals + retrait de l'UI d'ajout)
    compFields: [
      ['color', 'field.color', 'color'],
      ['brightness', 'field.brightness', 'num'],
      ['mode', 'field.mode', 'ledmode'],
      ['period_ms', 'field.period', 'num', c => ['spinner', 'blink', 'breathe'].includes(c.mode)],
    ],
    placeFields: [],
    mockFields: [['value', 'field.mock_pct']],
    build: null,   // physique : édité dans l'inspecteur (sélection depuis l'arbre), aperçu via led-ring-preview.js
  },
  sound: {
    label: 'comp.sound',
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

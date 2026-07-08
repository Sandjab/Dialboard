// Rendu best-effort des widgets — 2e implémentation du rendu firmware (src/dashboard.cpp + src/view.cpp).
// ⚠ Double-maintenance assumée : tout changement de rendu firmware doit être répliqué ici. Le device arbitre.
// La math (ci-dessous) est pure et testée ; les builders DOM (plus bas) sont vérifiés au navigateur.

import { previewUrl } from './image-asset.js';
import { previewUrl as aimgPreviewUrl } from './image-anim-asset.js';
import { qrModules } from './qr.js';
import { ICONS } from '../vendor/icons/icons-data.js';

// Table nom d'icône -> glyphe MDI (rendu via @font-face 'mdi', parité firmware ICON_GLYPHS).
export const ICON_CHAR = Object.fromEntries(ICONS.map(i => [i.name, i.ch]));

// Valeurs d'aperçu mock par défaut. Plan C les rendra éditables via l'inspecteur ; ici elles sont fixes.
export const MOCKS = {
  readout: { value: 42 },
  bar:     { value: 60 },
  ring:    { value: 72, reset_in_s: 18000 },
  chart:   { hist: [20, 35, 30, 50, 45, 60, 55, 70, 65, 80, 60, 75, 50, 65, 55, 72] },  // serie demo (forme indicative)
  meter:   { value: 60 },
  led:     { value: 1 },
  led_ring:{ value: 50 },
  icon:    { value: 0 },
  slider:  { value: 50 },
  arc:     { value: 50 },
  roller:  { value: 0 },
  stepper: { value: 21 },
  segmented: { value: 0 },
  state:   { value: 0 }
};

// Réglages PRIMAIRES du rendu LED réaliste (réglés au playground ; cf. spec led-look-realiste),
// figés et partagés avec le firmware pour la parité. Les booléens du composant
// (glow/bezel/specular/off_glass) activent chaque effet. Les facteurs DÉRIVÉS propres au rendu CSS
// (blur*2, spr*1.5, a*0.4, alphas du bezel, stops du reflet) vivent dans le corps de buildLed : ils
// n'ont pas d'équivalent firmware 1:1.
const LED = {
  lightX: 38, lightY: 30, highlight: 62, edgeDark: 24,
  glowBlur: 20, glowSpread: 5, glowAlpha: 1.0,
  specSize: 24, specAlpha: 0.62, rimDepth: 8,
  offDark: 69, offSpecAlpha: 0.12,
};
const LED_WHITE = [255, 255, 255], LED_BLACK = [0, 0, 0];
function ledHexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function ledMix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function ledRgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

// Taille de police rendue (px). Tiny TTF rend n'importe quelle taille → on renvoie la valeur exacte,
// clampée au domaine schéma [8,120] ; valeur absente → défaut 20 (miroir firmware).
export function pickFontPx(font) {
  const n = Math.round(Number(font));
  if (!Number.isFinite(n)) return 20;
  return Math.max(8, Math.min(120, n));
}

// bar : fraction remplie (clampée). Miroir lv_bar : (value − min) / (max − min).
export function barFill(value, min = 0, max = 100) {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// bar : géométrie du remplissage en fractions 0..1 le long de l'axe (0 = bord min). normal = du bord
// à la valeur ; symmetrical = entre la position du 0 et la valeur (min négatif). Miroir lv_bar
// LV_BAR_MODE_NORMAL/SYMMETRICAL. Renvoie {start, len}.
export function barGeometry(value, min = 0, max = 100, mode = 'normal') {
  const v = barFill(value, min, max);
  if (mode === 'symmetrical') {
    const zero = barFill(0, min, max);
    return { start: Math.min(zero, v), len: Math.abs(v - zero) };
  }
  return { start: 0, len: v };
}

// ring : couleur de seuil — 1er seuil dont value < limite, sinon couleur de base. Miroir threshold_color (color.cpp:13).
export function pickThresholdColor(thresholds, value, base) {
  for (const [limit, color] of thresholds || []) {
    if (value < limit) return color;
  }
  return base;
}

// led : allumé si value >= off_below, sinon éteint. Miroir firmware led_is_lit (color.cpp).
export function ledLit(value, offBelow = 1) {
  return value >= offBelow;
}

// readout : "<num> <unit>". Miroir format_value (format.cpp:19) : entier brut sinon 1 décimale.
export function formatValue(v, unit) {
  const num = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return unit ? `${num} ${unit}` : num;
}

// ring countdown : reste formaté. Miroir format_remaining (format.cpp:5).
export function formatRemaining(s) {
  if (s >= 86400) return `${Math.floor(s / 86400)}j${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600)  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  if (s >= 60)    return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

// ring : balayage (deg) de l'indicateur = fraction × (360 − gap). L'ouverture (gap) reste en bas.
export function ringSweepDeg(value, min, max, gapDeg) {
  return barFill(value, min, max) * (360 - gapDeg);
}

// ring : angles de l'indicateur (deg) selon le mode. start = début de l'arc de fond, span = balayage
// total (360 − gap), fillFrac = fraction 0..1. Miroir lv_arc NORMAL (horaire), REVERSE (anti-horaire,
// depuis le max) et SYMMETRICAL (depuis le milieu de l'arc). Renvoie {startDeg, sweepDeg} (sweep ≥ 0,
// tracé horaire par arcPath).
export function arcIndicatorAngles(mode, start, span, fillFrac) {
  const f = Math.max(0, Math.min(1, fillFrac));
  if (mode === 'reverse') return { startDeg: start + (1 - f) * span, sweepDeg: f * span };
  if (mode === 'symmetrical') {
    const mid = start + span / 2;
    return f >= 0.5 ? { startDeg: mid, sweepDeg: (f - 0.5) * span }
                    : { startDeg: start + f * span, sweepDeg: (0.5 - f) * span };
  }
  return { startDeg: start, sweepDeg: f * span };
}

// Point sur un cercle, convention écran (0°=droite, 90°=bas car y vers le bas) — identique à LVGL.
export function pointOnArc(cx, cy, r, deg) {
  const rad = deg * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

// Chemin SVG d'un arc : centre (cx,cy), rayon r, de startDeg, balayé de sweepDeg dans le sens horaire écran.
export function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const [x1, y1] = pointOnArc(cx, cy, r, startDeg);
  const [x2, y2] = pointOnArc(cx, cy, r, startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  const f = n => n.toFixed(2);
  return `M ${f(x1)} ${f(y1)} A ${r} ${r} 0 ${large} 1 ${f(x2)} ${f(y2)}`;
}

// ring cap : chemin SVG de l'arc MÉDIAN du texte courbe, dans l'ouverture du bas. Arc inférieur
// tracé gauche→droite (sweep-flag 0) pour un texte lisible (sourire), rayon (r − th/2) = milieu de
// la bande comme le firmware (lv_arclabel_set_radius = q.radius − q.thickness/2, view.cpp). Le texte
// est centré sur cet arc (dominant-baseline:central ↔ vertical_align CENTER), donc le milieu des
// lettres tombe sur le cercle médian de l'anneau quelles que soient l'épaisseur et la fonte.
// Centre du wrap = (r, r). L'ouverture est rotée par start_angle (défaut 0 = bas), en parité avec le
// firmware (lv_arclabel_set_angle_start(90 + start_angle - gap/2), view.cpp) et ringPaths.
export function capArcPath(r, th, gap, startAngle = 0) {
  const br = r - th / 2;
  const half = gap / 2;
  const [x1, y1] = pointOnArc(r, r, br, 90 + startAngle + half);   // extrémité gauche de l'ouverture (rotée par start_angle)
  const [x2, y2] = pointOnArc(r, r, br, 90 + startAngle - half);   // extrémité droite de l'ouverture
  const f = n => n.toFixed(2);
  return `M ${f(x1)} ${f(y1)} A ${br} ${br} 0 0 0 ${f(x2)} ${f(y2)}`;
}

// ring : chemins fond + indicateur (rayon de tracé au milieu de la bande). Centralise la géométrie
// d'arc partagée par buildRing (initial) et canvas.js paintRing (live resize). Miroir view.cpp:54.
export function ringPaths(r, th, gap, value, min, max, mode = 'normal', startAngle = 0) {
  const rr = r - th / 2;                    // rayon au centre de la bande
  const start = 90 + startAngle + gap / 2;  // lv_arc_set_bg_angles(arc, 90 + start_angle + gap/2, …) (view.cpp)
  const span = 360 - gap;
  const ind = arcIndicatorAngles(mode, start, span, barFill(value, min, max));
  return {
    rr, start,
    track:     arcPath(r, r, rr, start, span),
    indicator: arcPath(r, r, rr, ind.startDeg, ind.sweepDeg)
  };
}

// chart : coordonnées [x,y] des échantillons. x reparti sur la largeur, y inverse (0 en bas),
// clampe via barFill. Base partagée de la polyline ET des points (dots). Miroir lv_chart LINE.
export function sparklineCoords(hist, min, max, w, h) {
  if (!hist || hist.length === 0) return [];
  const n = hist.length;
  return hist.map((v, i) => [n > 1 ? (i / (n - 1)) * w : 0, h - barFill(v, min, max) * h]);
}

// chart : suite de points SVG "x,y …" pour une polyline. Miroir best-effort de lv_chart LINE (view.cpp:181).
export function sparklinePoints(hist, min, max, w, h) {
  const f = v => v.toFixed(2);
  return sparklineCoords(hist, min, max, w, h).map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
}

// meter : angle de l'aiguille (deg, convention pointOnArc : 0°=droite, horaire, y bas). Miroir
// lv_meter_set_scale_range(min, max, 270, 135) (view.cpp:216) : 135° a min → 405° a max.
export function meterAngle(value, min, max) {
  return 135 + barFill(value, min, max) * 270;
}

// --- Builders DOM (non testés sous Node ; vérifiés au navigateur). Aucun ne s'exécute à l'import. ---

// Familles → pile CSS (parité Tiny TTF côté device). Famille inconnue → montserrat.
const FONT_STACKS = {
  montserrat:     'Montserrat, system-ui, sans-serif',
  jetbrains_mono: "'JetBrains Mono', ui-monospace, monospace",
  lora:           'Lora, system-ui, serif',
  inter:          'Inter, system-ui, sans-serif',
};
// Raccourci CSS `font` : [italic] [700] <px>px <stack>.
export function font(family, bold, italic, px) {
  const stack = FONT_STACKS[family] || FONT_STACKS.montserrat;
  return `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${px}px ${stack}`;
}
const SVGNS = 'http://www.w3.org/2000/svg';

let capSeq = 0;   // ids uniques pour les <textPath> de cap (un par rendu de ring)

export function buildLabel(comp, placement = {}) {
  const n = document.createElement('div');
  n.className = 'w w-label';
  n.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
  n.style.color = comp.color || '#FFFFFF';
  if (comp.fill != null) n.style.background = comp.fill;          // absent = transparent
  const bw = comp.border_width || 0;
  if (bw > 0) { n.style.boxSizing = 'border-box'; n.style.border = `${bw}px solid ${comp.border_color || '#FFFFFF'}`; }
  if ((placement.radius || 0) > 0) n.style.borderRadius = placement.radius + 'px';
  const px = comp.pad_x || 0, py = comp.pad_y || 0;               // marge interne autour du texte (pad_hor/pad_ver côté firmware)
  if (px > 0 || py > 0) n.style.padding = `${py}px ${px}px`;
  n.textContent = comp.text || 'Label';
  return n;
}

export function buildReadout(comp, mock = MOCKS.readout) {
  const n = document.createElement('div');
  n.className = 'w w-readout';
  n.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
  n.style.color = comp.color || '#FFFFFF';
  const val = formatValue(mock.value, comp.unit || '');
  n.textContent = comp.label ? `${comp.label} ${val}` : val; // miroir view.cpp:201-209
  return n;
}

export function buildBar(comp, placement, mock = MOCKS.bar) {
  const wrap = document.createElement('div');
  wrap.className = 'w w-bar';
  const track = document.createElement('div');
  track.className = 'w-bar-track';
  track.style.width  = (placement.width  || 200) + 'px'; // défauts firmware (view.cpp)
  track.style.height = (placement.height || 16)  + 'px';
  const fill = document.createElement('div');
  fill.className = 'w-bar-fill';
  const { start, len } = barGeometry(mock.value, comp.min ?? 0, comp.max ?? 100, comp.mode || 'normal');
  const pct = n => (n * 100) + '%';
  if (comp.orientation === 'vertical') {       // lv_bar vertical : remplit depuis le bas
    fill.style.left = '0'; fill.style.width = '100%';
    fill.style.bottom = pct(start); fill.style.height = pct(len);
  } else {
    fill.style.top = '0'; fill.style.height = '100%';
    fill.style.left = pct(start); fill.style.width = pct(len);
  }
  fill.style.background = pickThresholdColor(comp.thresholds, mock.value, comp.color || '#38BDF8'); // seuil comme le ring
  track.appendChild(fill);
  wrap.appendChild(track);                    // track d'abord = référence de taille du wrap
  if (comp.label) {                           // label hors flux (absolu) → ne fausse pas le placement de la barre
    const lbl = document.createElement('div');
    lbl.className = 'w-bar-label w-bar-label--' + (comp.label_align || 'TOP_MID');
    lbl.textContent = comp.label;
    lbl.style.color = comp.label_color || '#9AA0AA';
    lbl.style.font = font(comp.label_family, comp.label_bold, comp.label_italic, pickFontPx(comp.label_font ?? 14));
    wrap.appendChild(lbl);
  }
  return wrap;
}

export function buildRing(comp, placement, mock = MOCKS.ring) {
  const r   = placement.radius    || 80;
  const th  = placement.thickness || 16;
  const gap = placement.gap_deg ?? 70;
  const size = r * 2;
  const wrap = document.createElement('div');
  wrap.className = 'w w-ring';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const sa = placement.start_angle ?? 0;
  const { track, indicator } = ringPaths(r, th, gap, mock.value, comp.min ?? 0, comp.max ?? 100, comp.mode || 'normal', sa);
  const col = pickThresholdColor(comp.thresholds, mock.value, comp.color || '#38BDF8');
  const cap = (comp.rounded ?? true) ? 'round' : 'butt';   // arc_rounded firmware (défaut arrondi)
  const mk = (cls, d, stroke) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', th);
    p.setAttribute('stroke-linecap', cap);
    return p;
  };
  svg.appendChild(mk('ring-track', track, '#1F2937')); // fond firmware (view.cpp:58)
  svg.appendChild(mk('ring-ind', indicator, col));
  wrap.appendChild(svg);
  if (comp.center_pct) {                        // lecture centrale (value+unit)
    const ctr = document.createElement('div');
    ctr.className = 'w-ring-center';
    ctr.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
    ctr.style.color = comp.center_color || col; // center_color surcharge le seuil (view.cpp:168)
    ctr.textContent = formatValue(mock.value, comp.unit || '');
    wrap.appendChild(ctr);
  }
  const capText = (comp.cap_prefix || '') + (comp.countdown ? formatRemaining(mock.reset_in_s) : '');
  if (capText) {                              // texte courbe dans l'ouverture du bas (view.cpp build_ring/sync_ring)
    const capId = `cap-arc-${capSeq++}`;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('id', capId);
    path.setAttribute('class', 'cap-arc');
    path.setAttribute('d', capArcPath(r, th, gap, sa));
    path.setAttribute('fill', 'none');
    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('class', 'w-ring-cap');
    text.setAttribute('fill', comp.color || '#38BDF8');
    text.style.font = font(comp.cap_family, comp.cap_bold, comp.cap_italic, pickFontPx(comp.cap_font ?? 14));
    const tp = document.createElementNS(SVGNS, 'textPath');
    tp.setAttribute('href', `#${capId}`);
    tp.setAttribute('startOffset', '50%');
    tp.setAttribute('text-anchor', 'middle');         // centre le texte sur le milieu de l'arc (bas) ↔ h_align CENTER firmware
    tp.setAttribute('dominant-baseline', 'central');  // centre le texte VERTICALEMENT sur l'arc (rayon r-th) ↔ v_align CENTER firmware (sinon baseline sur l'arc → texte trop rentré)
    tp.textContent = capText;
    text.appendChild(tp);
    svg.appendChild(path);
    svg.appendChild(text);
  }
  return wrap;
}

export function buildChart(comp, placement, mock = MOCKS.chart) {
  const w = placement.width || 200, h = placement.height || 100;  // defauts firmware (view.cpp:184)
  const pad = 8;                                  // marge de plot (le device n'accole pas la courbe au bord)
  const iw = w - pad * 2, ih = h - pad * 2;
  const color = comp.color || '#38BDF8';
  const wrap = document.createElement('div');
  wrap.className = 'w w-chart';                   // fond clair + bordure + radius via CSS (thème lv_chart)
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('transform', `translate(${pad},${pad})`);
  // grille : lignes de division (best-effort du thème lv_chart par défaut)
  const VDIV = 5, HDIV = 3;
  const grid = (x1, y1, x2, y2) => {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', 'chart-grid');
    g.appendChild(l);
  };
  for (let i = 0; i <= VDIV; i++) grid((i / VDIV) * iw, 0, (i / VDIV) * iw, ih);
  for (let j = 0; j <= HDIV; j++) grid(0, (j / HDIV) * ih, iw, (j / HDIV) * ih);
  // courbe + points
  const coords = sparklineCoords(mock.hist || [], comp.min ?? 0, comp.max ?? 100, iw, ih);
  const line = document.createElementNS(SVGNS, 'polyline');
  line.setAttribute('points', coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', 2);
  g.appendChild(line);
  for (const [x, y] of coords) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', x.toFixed(2)); c.setAttribute('cy', y.toFixed(2)); c.setAttribute('r', 2.5);
    c.setAttribute('fill', color);
    g.appendChild(c);
  }
  svg.appendChild(g);
  wrap.appendChild(svg);
  return wrap;
}

export function buildMeter(comp, placement, mock = MOCKS.meter) {
  const w = placement.width || 160;             // defauts firmware (view.cpp:211-212)
  const h = placement.height || w;
  const size = Math.min(w, h);
  const cx = w / 2, cy = h / 2;
  const Rout = size / 2 - 6;                     // rim extérieur (arc + ticks)
  const min = comp.min ?? 0, max = comp.max ?? 100;
  const color = comp.color || '#38BDF8';
  const wrap = document.createElement('div');
  wrap.className = 'w w-meter';
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // LVGL 9 : lv_scale n'a pas de fond plein ni de moyeu (contrairement à l'ancien lv_meter).
  const mkPath = (d, stroke, sw) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', sw);
    return p;
  };
  svg.appendChild(mkPath(arcPath(cx, cy, Rout, 135, 270), '#4B5563', 5));  // arc de fond 270° (view.cpp:216)
  let prev = min;                                                          // zones (prev, limit] width 5 (view.cpp:217-224)
  for (const [limit, c] of comp.thresholds || []) {
    svg.appendChild(mkPath(arcPath(cx, cy, Rout, meterAngle(prev, min, max),
                                   meterAngle(limit, min, max) - meterAngle(prev, min, max)), c, 5));
    prev = limit;
  }
  // graduations : 21 ticks, 1 majeur/5 → 0/25/50/75/100, + chiffres (view.cpp:214-215)
  for (let k = 0; k <= 20; k++) {
    const v = min + (max - min) * k / 20;
    const ang = meterAngle(v, min, max);
    const major = k % 5 === 0;
    const [ox, oy] = pointOnArc(cx, cy, Rout - 3, ang);
    const [ix, iy] = pointOnArc(cx, cy, Rout - 3 - (major ? 12 : 7), ang);
    const t = document.createElementNS(SVGNS, 'line');
    t.setAttribute('x1', ox.toFixed(2)); t.setAttribute('y1', oy.toFixed(2));
    t.setAttribute('x2', ix.toFixed(2)); t.setAttribute('y2', iy.toFixed(2));
    t.setAttribute('stroke', major ? '#9CA3AF' : '#4B5563');
    t.setAttribute('stroke-width', major ? 3 : 2);
    svg.appendChild(t);
    if (major) {
      const [tx, ty] = pointOnArc(cx, cy, Rout - 28, ang);
      const txt = document.createElementNS(SVGNS, 'text');
      txt.setAttribute('x', tx.toFixed(2)); txt.setAttribute('y', ty.toFixed(2));
      txt.setAttribute('class', 'meter-num');
      txt.textContent = String(Math.round(v));
      svg.appendChild(txt);
    }
  }
  const [px, py] = pointOnArc(cx, cy, Rout - 16, meterAngle(mock.value, min, max));  // aiguille
  const needle = document.createElementNS(SVGNS, 'line');
  needle.setAttribute('x1', cx); needle.setAttribute('y1', cy);
  needle.setAttribute('x2', px.toFixed(2)); needle.setAttribute('y2', py.toFixed(2));
  needle.setAttribute('stroke', color);
  needle.setAttribute('stroke-width', 4);
  needle.setAttribute('stroke-linecap', 'round');
  svg.appendChild(needle);
  wrap.appendChild(svg);
  return wrap;
}

// Image animee : pack multi-frames RGB565A8. Apercu statique = frame de repos (parite avec le device
// a l'arret). Meme conteneur CSS que buildImage (w-image) pour reutiliser le placeholder styled.
export function buildImageAnim(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'w w-image';
  wrap.style.width  = (comp.w || 120) + 'px';
  wrap.style.height = (comp.h || 120) + 'px';
  // Apercu statique = frame de repos (parite avec le device a l'arret).
  const url = comp.src ? aimgPreviewUrl(comp.src, comp.rest_frame || 0) : null;
  if (url) {
    const img = document.createElement('img');
    img.className = 'w-image-img';
    img.src = url;
    img.style.width = '100%'; img.style.height = '100%';
    img.style.display = 'block'; img.style.objectFit = 'fill';
    wrap.appendChild(img);
  } else {
    wrap.classList.add('w-image--empty');
  }
  return wrap;
}

// Image placee : bitmap statique a w×h (taille sur le composant). Apercu depuis le cache image-asset
// (previewUrl) ; placeholder borde tant qu'aucune image n'est choisie ou que le cache n'a pas d'octets
// (post-reload avant « Charger »). Le firmware rend un lv_img RGB565A8 (cf. view.cpp build_image).
export function buildImage(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'w w-image';
  wrap.style.width  = (comp.w || 120) + 'px';
  wrap.style.height = (comp.h || 120) + 'px';
  const url = comp.src ? previewUrl(comp.src) : null;
  if (url) {
    const img = document.createElement('img');
    img.className = 'w-image-img';
    img.src = url;
    img.style.width = '100%'; img.style.height = '100%';
    img.style.display = 'block'; img.style.objectFit = 'fill';   // etirement libre = deformation assumee
    wrap.appendChild(img);
  } else {
    wrap.classList.add('w-image--empty');
  }
  return wrap;
}

// led : voyant réaliste. Corps en dégradé radial (dôme) ; couleur = seuil sinon color ; éteint
// (assombri, sans glow) sous off_below. Effets pilotés par booléens (défaut true). Miroir best-effort
// de lv_led stylé (view.cpp build_led/sync_led). Constantes figées = objet LED.
export function buildLed(comp, placement, mock = MOCKS.led) {
  const size = placement.size || 24;
  const lit  = ledLit(mock.value, comp.off_below ?? 1);
  const colHex = pickThresholdColor(comp.thresholds, mock.value, comp.color || '#22C55E');
  const color = ledHexRgb(colHex);
  const glow = comp.glow ?? true, bezel = comp.bezel ?? true;
  const specular = comp.specular ?? true, offGlass = comp.off_glass ?? true;

  const n = document.createElement('div');
  n.className = 'w w-led';
  n.style.width = size + 'px';
  n.style.height = size + 'px';

  // Corps : dôme radial (centre éclairci, bord assombri), éclairé depuis lightX/lightY.
  const center = lit ? ledMix(color, LED_WHITE, LED.highlight / 100) : ledMix(ledMix(color, LED_BLACK, LED.offDark / 100), LED_WHITE, 0.07);
  const mid    = lit ? color : ledMix(color, LED_BLACK, LED.offDark / 100);
  const edge   = lit ? ledMix(color, LED_BLACK, LED.edgeDark / 100) : ledMix(mid, LED_BLACK, 0.28);
  n.style.background = `radial-gradient(circle at ${LED.lightX}% ${LED.lightY}%, ${ledRgb(center)} 0%, ${ledRgb(mid)} 50%, ${ledRgb(edge)} 100%)`;

  // Ombres : glow externe (allumé) + bezel encastré (interne) + contour.
  const sh = [];
  if (glow && lit) {
    const blur = LED.glowBlur, spr = LED.glowSpread, a = LED.glowAlpha;
    sh.push(`0 0 ${blur}px ${spr}px rgba(${color[0]},${color[1]},${color[2]},${a})`);
    sh.push(`0 0 ${blur * 2}px ${Math.round(spr * 1.5)}px rgba(${color[0]},${color[1]},${color[2]},${a * 0.4})`);
  }
  if (bezel) {
    const d = LED.rimDepth;
    sh.push(`inset 0 0 ${d}px rgba(0,0,0,.55)`);
    sh.push(`inset 0 ${Math.max(1, Math.round(d / 3))}px ${Math.round(d / 2)}px rgba(0,0,0,.45)`);
    sh.push(`inset 0 -1px 1px rgba(255,255,255,.12)`);
  }
  sh.push(`0 0 0 1px rgba(0,0,0,.45)`);
  n.style.boxShadow = sh.join(', ');

  // Reflet spéculaire (enfant) : allumé → specAlpha ; éteint → offSpecAlpha si off_glass, sinon absent.
  const showSpec = specular && (lit ? LED.specAlpha > 0 : (offGlass && LED.offSpecAlpha > 0));
  if (showSpec) {
    const a = lit ? LED.specAlpha : LED.offSpecAlpha;
    const sp = document.createElement('div');
    sp.className = 'w-led-spec';
    const sz = size * LED.specSize / 100;
    sp.style.width = sz + 'px';
    sp.style.height = sz + 'px';
    sp.style.left = (size * LED.lightX / 100 - sz / 2) + 'px';
    sp.style.top  = (size * LED.lightY / 100 - sz / 2) + 'px';
    sp.style.background = `radial-gradient(circle at 50% 50%, rgba(255,255,255,${a}) 0%, rgba(255,255,255,${a * 0.35}) 38%, rgba(255,255,255,0) 70%)`;
    n.appendChild(sp);
  }
  return n;
}

// --- Formes de base (décoratives, statiques). bg/border CSS ↔ lv_obj ; bordure DANS la box (box-sizing). ---
const DASH_CSS = { solid: 'solid', dashed: 'dashed', dotted: 'dotted' };

export function buildRect(comp, placement) {
  const n = document.createElement('div');
  n.className = 'w w-rect';
  n.style.boxSizing = 'border-box';
  n.style.width  = (placement.width  || 120) + 'px';
  n.style.height = (placement.height || 60)  + 'px';
  n.style.background = comp.fill != null ? comp.fill : 'transparent';
  const bw = comp.border_width || 0;
  n.style.border = bw > 0 ? `${bw}px solid ${comp.border_color || '#FFFFFF'}` : 'none';
  n.style.borderRadius = (placement.radius || 0) + 'px';
  return n;
}

export function buildCircle(comp, placement) {
  const n = document.createElement('div');
  n.className = 'w w-circle';
  n.style.boxSizing = 'border-box';
  const d = placement.size || 60;
  n.style.width = d + 'px'; n.style.height = d + 'px';
  n.style.borderRadius = '50%';
  n.style.background = comp.fill != null ? comp.fill : 'transparent';
  const bw = comp.border_width || 0;
  n.style.border = bw > 0 ? `${bw}px solid ${comp.border_color || '#FFFFFF'}` : 'none';
  return n;
}

export function buildLine(comp, placement) {
  const n = document.createElement('div');
  n.className = 'w w-line';
  const len = placement.width || 120;
  const th  = placement.thickness || 2;
  const style = DASH_CSS[comp.dash] || 'solid';
  const color = comp.color || '#FFFFFF';
  if (comp.orientation === 'vertical') {
    n.style.width = '0'; n.style.height = len + 'px';
    n.style.borderLeft = `${th}px ${style} ${color}`;
  } else {
    n.style.height = '0'; n.style.width = len + 'px';
    n.style.borderTop = `${th}px ${style} ${color}`;
  }
  if (comp.rounded) n.style.borderRadius = Math.ceil(th / 2) + 'px';
  return n;
}

// --- Icône / symbole : lv_label en police de symboles (firmware) ; SVG equivalent (designer). ---
// Map nom -> fragment SVG (enfants d'un <svg> viewBox 0 0 24 24). stroke/fill = currentColor (couleur via
// Résolveur PUR (miroir firmware icon_resolve) : 1re bande où value < at ; champ omis -> base.
export function resolveIcon(comp, value) {
  let symbol = comp.symbol || 'bell';
  let color = comp.color || '#FFFFFF';
  const val = Number(value ?? 0);                 // défensif : aligne sur le cast (float)c.value du firmware
  for (const st of comp.states || []) {
    if (val < st.at) {
      if (st.symbol != null) symbol = st.symbol;
      if (st.color != null) color = st.color;
      break;
    }
  }
  return { symbol, color };
}

// Résolveur PUR (miroir firmware state_resolve) : rend l'index du cas actif ou -1 (défaut).
// exact : selon le type de la valeur (number ↔ clé number ; string ↔ clé string). range : numérique seul, 1er value < at.
export function resolveState(comp, value) {
  const cases = comp.cases || [];
  const match = comp.match || 'exact';
  const isNum = typeof value === 'number';
  if (match === 'range') {
    if (!isNum) return -1;                            // range = numérique seul ; string -> défaut
    for (let i = 0; i < cases.length; i++) if (value < cases[i].at) return i;
    return -1;
  }
  for (let i = 0; i < cases.length; i++) {            // exact : 1er match selon le type de la valeur
    const k = cases[i].key;
    if (isNum) { if (typeof k === 'number' && k === value) return i; }
    else       { if (typeof k !== 'number' && String(k) === String(value)) return i; }
  }
  return -1;
}

export function buildIcon(comp, mock = MOCKS.icon) {
  const { symbol, color } = resolveIcon(comp, mock.value);
  const px = pickFontPx(comp.font ?? 28);
  const n = document.createElement('div');
  n.className = 'w w-icon';
  n.style.width = px + 'px';
  n.style.height = px + 'px';
  n.style.color = color;
  const i = document.createElement('i');
  i.className = 'mdi';
  i.style.fontSize = px + 'px';
  i.textContent = ICON_CHAR[symbol] || ICON_CHAR.bell || '';
  n.appendChild(i);
  return n;
}

// State : affiche UN visuel (glyphe ou image) choisi par la valeur mock (resolveState). Parité firmware
// build/sync_state : glyphe = <i class="mdi"> (comme buildIcon) ; image = <img> previewUrl (comme buildImage).
export function buildState(comp, mock = MOCKS.state) {
  const idx = resolveState(comp, mock.value);
  const cases = comp.cases || [];
  const vis = idx < 0 ? (comp.default || {}) : cases[idx];
  if (vis.src) {                                       // visuel image (miroir buildImage)
    const wrap = document.createElement('div');
    wrap.className = 'w w-image';
    wrap.style.width  = (vis.w || 120) + 'px';
    wrap.style.height = (vis.h || 120) + 'px';
    const url = previewUrl(vis.src);
    if (url) {
      const img = document.createElement('img');
      img.className = 'w-image-img';
      img.src = url;
      img.style.width = '100%'; img.style.height = '100%';
      img.style.display = 'block'; img.style.objectFit = 'fill';
      wrap.appendChild(img);
    } else {
      wrap.classList.add('w-image--empty');
    }
    return wrap;
  }
  const px = pickFontPx(comp.font ?? 64);              // visuel glyphe (miroir buildIcon)
  const n = document.createElement('div');
  n.className = 'w w-icon';
  n.style.width = px + 'px';
  n.style.height = px + 'px';
  n.style.color = vis.color || '#FFFFFF';
  const i = document.createElement('i');
  i.className = 'mdi';
  i.style.fontSize = px + 'px';
  i.textContent = ICON_CHAR[vis.symbol] || ICON_CHAR.bell || '';
  n.appendChild(i);
  return n;
}

// --- Effecteurs (Plan C). Parité firmware : view.cpp build_switch/build_button. ---

// switch : piste arrondie (état repos = off, gris) + poignée circulaire à gauche. Taille = placement
// width/height (défaut firmware 60×30, cf. build_switch). Pas de champ de style (le firmware rend le
// switch au thème LVGL par défaut) → aperçu statique off.
export function buildSwitch(_comp, placement = {}) {
  const w = placement.width || 60, h = placement.height || 30;
  const n = document.createElement('div');
  n.className = 'w w-switch';
  n.style.width = w + 'px';
  n.style.height = h + 'px';
  n.style.borderRadius = (h / 2) + 'px';
  const knob = document.createElement('div');
  knob.className = 'w-switch-knob';
  const kd = Math.max(2, h - 6);           // poignée : marge 3px sur chaque bord
  knob.style.width = kd + 'px';
  knob.style.height = kd + 'px';
  knob.style.left = '3px';                 // off = poignée à gauche
  knob.style.top = '3px';
  n.appendChild(knob);
  return n;
}

// button : rectangle arrondi + libellé blanc centré. Taille = placement width/height (défaut 100×44).
// Police générique du composant (défaut 20, comme le firmware). Le fond/rayon approchent le bouton LVGL
// par défaut (le chrome exact suit le thème device ; la parité porte sur taille/texte/position).
export function buildButton(comp, placement = {}) {
  const w = placement.width || 100, h = placement.height || 44;
  const n = document.createElement('div');
  n.className = 'w w-button';
  n.style.width = w + 'px';
  n.style.height = h + 'px';
  const lbl = document.createElement('span');
  lbl.className = 'w-button-label';
  lbl.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
  lbl.textContent = comp.text || 'Button';
  n.appendChild(lbl);
  return n;
}

// slider : piste + indicateur (couleur) + knob, à la position d'aperçu. Orientation h/v (pas de swap
// W/H : le firmware oriente le widget dans la boîte width×height telle quelle, view.cpp:588-591).
export function buildSlider(comp, placement = {}, mock = MOCKS.slider) {
  const w = placement.width || 200, h = placement.height || 16;
  const vert = comp.orientation === 'vertical';
  const wrap = document.createElement('div');
  wrap.className = 'w w-slider';
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  const track = document.createElement('div');
  track.className = 'w-slider-track';
  const ind = document.createElement('div');
  ind.className = 'w-slider-ind';
  ind.style.background = comp.color || '#FFFFFF';   // fallback = défaut firmware (dashboard.cpp: color | "#FFFFFF")
  const frac = barFill(mock.value, comp.min ?? 0, comp.max ?? 100);   // 0..1
  const knob = document.createElement('div');
  knob.className = 'w-slider-knob';
  const kd = vert ? w : h;                          // knob = épaisseur de la piste
  knob.style.width = kd + 'px';
  knob.style.height = kd + 'px';
  if (vert) {                                       // remplit depuis le bas
    ind.style.left = '0'; ind.style.width = '100%';
    ind.style.bottom = '0'; ind.style.height = (frac * 100) + '%';
    knob.style.left = '50%';
    knob.style.bottom = `calc(${frac * 100}% - ${kd / 2}px)`;
    knob.style.transform = 'translateX(-50%)';
  } else {                                          // remplit depuis la gauche
    ind.style.top = '0'; ind.style.height = '100%';
    ind.style.left = '0'; ind.style.width = (frac * 100) + '%';
    knob.style.top = '50%';
    knob.style.left = `calc(${frac * 100}% - ${kd / 2}px)`;
    knob.style.transform = 'translateY(-50%)';
  }
  track.appendChild(ind);
  wrap.appendChild(track);
  wrap.appendChild(knob);
  return wrap;
}

// arc : effecteur circulaire. Réutilise ringPaths (piste + indicateur) ; pas de centre/cap (≠ ring).
// Piste MAIN gris #1F2937 (view.cpp:613), indicateur comp.color. Invariant pointer-events : seuls les
// paths peints captent le clic (CSS .w-arc) → un clic au centre vide désélectionne.
export function buildArc(comp, placement = {}, mock = MOCKS.arc) {
  const r = placement.radius || 80;
  const th = placement.thickness || 16;
  const gap = placement.gap_deg ?? 70;
  const sa = placement.start_angle ?? 0;
  const size = r * 2;
  const wrap = document.createElement('div');
  wrap.className = 'w w-arc';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const { track, indicator } = ringPaths(r, th, gap, mock.value, comp.min ?? 0, comp.max ?? 100, comp.mode || 'normal', sa);
  const cap = (comp.rounded ?? true) ? 'round' : 'butt';
  const mk = (cls, d, stroke) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', th);
    p.setAttribute('stroke-linecap', cap);
    return p;
  };
  svg.appendChild(mk('arc-track', track, '#1F2937'));
  svg.appendChild(mk('arc-ind', indicator, comp.color || '#FFFFFF'));   // fallback = défaut firmware (color | "#FFFFFF")
  wrap.appendChild(svg);
  return wrap;
}

// roller : colonne d'options, la sélectionnée (index d'aperçu) surlignée. width via placement (auto sinon).
// L'aperçu montre toutes les options seedées ; le firmware n'en montre que `rows` (limite d'aperçu assumée).
export function buildRoller(comp, placement = {}, mock = MOCKS.roller) {
  const opts = Array.isArray(comp.options) ? comp.options : [];
  const wrap = document.createElement('div');
  wrap.className = 'w w-roller';
  if (placement.width) wrap.style.width = placement.width + 'px';
  const sel = Math.max(0, Math.min(opts.length - 1, mock.value | 0));
  const list = document.createElement('div');
  list.className = 'w-roller-list';
  opts.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'w-roller-opt' + (i === sel ? ' selected' : '');
    d.textContent = o;
    list.appendChild(d);
  });
  wrap.appendChild(list);
  return wrap;
}

// segmented : options en boutons côte-à-côte, la sélectionnée (index d'aperçu) surlignée.
// écrit bind = index sélectionné (comme roller). width via placement.
export function buildSegmented(comp, placement = {}, mock = { value: 0 }) {
  const opts = Array.isArray(comp.options) ? comp.options : [];
  const wrap = document.createElement('div');
  wrap.className = 'w w-segmented';
  if (placement.width) wrap.style.width = placement.width + 'px';
  const sel = Math.max(0, Math.min(opts.length - 1, mock.value | 0));
  opts.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'w-seg-opt' + (i === sel ? ' selected' : '');
    d.textContent = o;
    wrap.appendChild(d);
  });
  return wrap;
}

// stepper : boutons -/+ encadrant la valeur d'aperçu (mock.value + unit). Le clamp/pas
// (stepper_step) est pur et testé côté firmware (test_core) ; ici, pure assemblage DOM.
export function buildStepper(comp, placement = {}, mock = { value: 21 }) {
  const wrap = document.createElement('div');
  wrap.className = 'w w-stepper';
  wrap.style.width = (placement.width || 200) + 'px';
  wrap.style.height = (placement.height || 80) + 'px';
  const bs = (placement.height || 80) + 'px';               // boutons carrés = hauteur du conteneur (parité build_stepper)
  const bf = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 20));
  const mk = (txt) => { const b = document.createElement('div'); b.className = 'w-step-btn'; b.style.width = bs; b.style.height = bs; b.style.font = bf; b.textContent = txt; return b; };
  const val = document.createElement('div'); val.className = 'w-step-val';
  val.style.font = bf;
  val.style.color = comp.color || '#FFFFFF';
  val.textContent = `${mock.value}${comp.unit || ''}`;
  wrap.append(mk('-'), val, mk('+'));
  return wrap;
}

// rings : 1-3 anneaux concentriques (parité firmware build_rings/ring_geom.cpp : rayon de piste i =
// outer - th/2 - i*(th+4), anneau quasi complet de 90° à 90+359° comme lv_arc_set_bg_angles). Pas de
// bind/mock au niveau composant (per-track). Valeurs d'aperçu fixes (_RINGS_MOCK), Plan futur pour l'édition.
export const _RINGS_MOCK = { values: [72, 55, 40] };
export function buildRings(comp, placement = {}, mock = _RINGS_MOCK) {
  const outer = placement.radius || 90, th = placement.thickness || 14, size = outer * 2;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('w', 'w-rings');
  const tracks = Array.isArray(comp.tracks) ? comp.tracks : [];
  tracks.forEach((tk, i) => {
    const tkObj = (tk && typeof tk === 'object') ? tk : {};   // repli si élément malformé (layout externe)
    const r = outer - th / 2 - i * (th + 4);
    const frac = Math.max(0, Math.min(1, ((mock.values?.[i] ?? 0) - (tkObj.min ?? 0)) / ((tkObj.max ?? 100) - (tkObj.min ?? 0) || 1)));
    const track = arcPath(outer, outer, r, 90, 359);
    const ind = arcPath(outer, outer, r, 90, 359 * frac);
    const mk = (cls, d, stroke) => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('class', cls); p.setAttribute('d', d);
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', th); p.setAttribute('stroke-linecap', 'round');
      svg.appendChild(p);
    };
    mk('rings-track', track, '#1F2937');
    mk('rings-ind', ind, tkObj.color || '#38BDF8');
  });
  return svg;
}

// clock (digital) : texte figé HH:MM[:SS] (parité d'ALLURE, pas de sync live). Pur -> testable sans DOM.
export function clockDigitalText(comp) {
  return comp.show_seconds ? '10:10:36' : '10:10';
}

// buildClock rend une heure figée 10:10 (parité d'ALLURE, pas de sync live). Pas de bind, pas de mock.
export function buildClock(comp, placement = {}) {
  if (comp.mode === 'digital') {
    const n = document.createElement('div');
    n.className = 'w w-clock';
    n.style.font = font(comp.font_family, comp.bold, comp.italic, pickFontPx(comp.font ?? 28));
    n.style.color = comp.color || '#FFFFFF';
    n.textContent = clockDigitalText(comp);
    return n;
  }
  const r = placement.radius || 80, size = r * 2;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('w', 'w-clock');
  const col = comp.color || '#FFFFFF';
  const hand = (deg, len, w, c) => {
    const rad = deg * Math.PI / 180;
    const p = document.createElementNS(SVGNS, 'line');
    p.setAttribute('x1', r); p.setAttribute('y1', r);
    p.setAttribute('x2', (r + len * Math.sin(rad)).toFixed(1));
    p.setAttribute('y2', (r - len * Math.cos(rad)).toFixed(1));
    p.setAttribute('stroke', c); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
  };
  [0, 90, 180, 270].forEach(deg => hand(deg, r * 0.08, 3, '#3a4a63'));
  hand(305, r * 0.5, 6, col);
  hand(60,  r * 0.72, 4, col);
  if (comp.show_seconds) hand(216, r * 0.8, 2, '#38BDF8');
  return svg;
}

// buildQr rend le QR code via qrModules (jumeau JS de lv_qrcode, ECC MEDIUM). text vide -> URL device.
export function buildQr(comp, placement = {}) {
  const size = placement.size || placement.width || 140;
  const text = comp.text || 'http://dialboard.local';
  const { size: n, get } = qrModules(text);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.classList.add('w', 'w-qr');
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('width', n); bg.setAttribute('height', n);
  bg.setAttribute('fill', '#E8EEF7'); svg.appendChild(bg);
  const dark = comp.color || '#05070D';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!get(x, y)) continue;
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', 1); r.setAttribute('height', 1); r.setAttribute('fill', dark);
    svg.appendChild(r);
  }
  return svg;
}

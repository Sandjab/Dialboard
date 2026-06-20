// Rendu best-effort des widgets — 2e implémentation du rendu firmware (src/dashboard.cpp + src/view.cpp).
// ⚠ Double-maintenance assumée : tout changement de rendu firmware doit être répliqué ici. Le device arbitre.
// La math (ci-dessous) est pure et testée ; les builders DOM (plus bas) sont vérifiés au navigateur.

import { previewUrl } from './image-asset.js';
import { previewUrl as aimgPreviewUrl } from './image-anim-asset.js';

// Valeurs d'aperçu mock par défaut. Plan C les rendra éditables via l'inspecteur ; ici elles sont fixes.
export const MOCKS = {
  readout: { value: 42 },
  bar:     { value: 60 },
  ring:    { value: 72, reset_in_s: 18000 },
  chart:   { hist: [20, 35, 30, 50, 45, 60, 55, 70, 65, 80, 60, 75, 50, 65, 55, 72] },  // serie demo (forme indicative)
  meter:   { value: 60 }
};

// Police LVGL embarquée : 14/20/28/36/48 px (pick_font, view.cpp:21-27). Toute autre valeur retombe sur 14.
export function pickFontPx(font) {
  if (font >= 48) return 48;
  if (font >= 36) return 36;
  if (font >= 28) return 28;
  if (font >= 20) return 20;
  return 14;
}

// bar : fraction remplie (clampée). Miroir lv_bar : (value − min) / (max − min).
export function barFill(value, min = 0, max = 100) {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ring : couleur de seuil — 1er seuil dont value < limite, sinon couleur de base. Miroir threshold_color (color.cpp:13).
export function pickThresholdColor(thresholds, value, base) {
  for (const [limit, color] of thresholds || []) {
    if (value < limit) return color;
  }
  return base;
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

// ring cap : chemin SVG de la baseline du texte courbe, dans l'ouverture du bas. Arc inférieur
// tracé gauche→droite (sweep-flag 0) pour un texte lisible (sourire), rayon (r − th) comme le
// firmware (lv_arclabel_set_radius = q.radius − q.thickness, view.cpp). Centre du wrap = (r, r).
// Le designer ignore start_angle (ouverture toujours en bas, comme ringPaths).
export function capArcPath(r, th, gap) {
  const br = r - th;
  const half = gap / 2;
  const [x1, y1] = pointOnArc(r, r, br, 90 + half);   // extrémité gauche-bas
  const [x2, y2] = pointOnArc(r, r, br, 90 - half);   // extrémité droite-bas
  const f = n => n.toFixed(2);
  return `M ${f(x1)} ${f(y1)} A ${br} ${br} 0 0 0 ${f(x2)} ${f(y2)}`;
}

// ring : chemins fond + indicateur (rayon de tracé au milieu de la bande). Centralise la géométrie
// d'arc partagée par buildRing (initial) et canvas.js paintRing (live resize). Miroir view.cpp:54.
export function ringPaths(r, th, gap, value, min, max) {
  const rr = r - th / 2;           // rayon au centre de la bande
  const start = 90 + gap / 2;      // lv_arc_set_bg_angles(arc, 90 + gap/2, 90 − gap/2)
  return {
    rr, start,
    track:     arcPath(r, r, rr, start, 360 - gap),
    indicator: arcPath(r, r, rr, start, ringSweepDeg(value, min, max, gap))
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

const FONT = px => `${px}px Montserrat, system-ui, sans-serif`;
const SVGNS = 'http://www.w3.org/2000/svg';

let capSeq = 0;   // ids uniques pour les <textPath> de cap (un par rendu de ring)

export function buildLabel(comp) {
  const n = document.createElement('div');
  n.className = 'w w-label';
  n.style.font = FONT(pickFontPx(comp.font ?? 20));
  n.style.color = comp.color || '#FFFFFF';
  n.textContent = comp.text || 'Label';
  return n;
}

export function buildReadout(comp, mock = MOCKS.readout) {
  const n = document.createElement('div');
  n.className = 'w w-readout';
  n.style.font = FONT(pickFontPx(comp.font ?? 20));
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
  fill.style.width = (barFill(mock.value, comp.min ?? 0, comp.max ?? 100) * 100) + '%';
  fill.style.background = comp.color || '#38BDF8';
  track.appendChild(fill);
  wrap.appendChild(track);                    // track d'abord = référence de taille du wrap
  if (comp.label) {                           // label hors flux (absolu) → ne fausse pas le placement de la barre
    const lbl = document.createElement('div');
    lbl.className = 'w-bar-label w-bar-label--' + (comp.label_align || 'TOP_MID');
    lbl.textContent = comp.label;
    lbl.style.color = comp.label_color || '#9AA0AA';
    lbl.style.fontSize = (comp.label_font || 14) + 'px';
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
  const { track, indicator } = ringPaths(r, th, gap, mock.value, comp.min ?? 0, comp.max ?? 100);
  const col = pickThresholdColor(comp.thresholds, mock.value, comp.color || '#38BDF8');
  const mk = (cls, d, stroke) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', th);
    p.setAttribute('stroke-linecap', 'round');
    return p;
  };
  svg.appendChild(mk('ring-track', track, '#1F2937')); // fond firmware (view.cpp:58)
  svg.appendChild(mk('ring-ind', indicator, col));
  wrap.appendChild(svg);
  if (comp.center_pct) {                       // lecture centrale (prioritaire sur la pastille, view.cpp:89)
    const ctr = document.createElement('div');
    ctr.className = 'w-ring-center';
    ctr.style.font = FONT(pickFontPx(comp.font ?? 20));
    ctr.style.color = comp.center_color || col; // center_color surcharge le seuil (view.cpp:168)
    ctr.textContent = formatValue(mock.value, comp.unit || '');
    wrap.appendChild(ctr);
  } else if (comp.pill) {                       // pastille % en haut de bande (view.cpp:66-74)
    const pill = document.createElement('div');
    pill.className = 'w-ring-pill';
    pill.textContent = `${Math.trunc(mock.value)}%`; // tronque comme (long)c.value, view.cpp:220
    pill.style.background = col;
    pill.style.top = (th / 2) + 'px';           // centre de la pill sur le milieu de la bande (view.cpp:60)
    wrap.appendChild(pill);
  }
  const capText = (comp.cap_prefix || '') + (comp.countdown ? formatRemaining(mock.reset_in_s) : '');
  if (capText) {                              // texte courbe dans l'ouverture du bas (view.cpp build_ring/sync_ring)
    const capId = `cap-arc-${capSeq++}`;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('id', capId);
    path.setAttribute('class', 'cap-arc');
    path.setAttribute('d', capArcPath(r, th, gap));
    path.setAttribute('fill', 'none');
    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('class', 'w-ring-cap');
    text.setAttribute('fill', comp.color || '#38BDF8');
    text.setAttribute('font-size', '14');
    text.setAttribute('font-family', 'Montserrat, system-ui, sans-serif');
    const tp = document.createElementNS(SVGNS, 'textPath');
    tp.setAttribute('href', `#${capId}`);
    tp.setAttribute('startOffset', '50%');
    tp.setAttribute('text-anchor', 'middle');   // centre le texte sur le milieu de l'arc (bas) ↔ h_align CENTER firmware
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

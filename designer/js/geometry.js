// Modèle de positionnement : ancrage LVGL + offset (dx, dy). Pur, sans DOM.
// parent = carré 360×360 ; le widget s'aligne par le même "point d'ancrage" que le parent.
export const ANCHORS = ['CENTER','TOP_MID','BOTTOM_MID','LEFT_MID','RIGHT_MID','TOP_LEFT','TOP_RIGHT','BOTTOM_LEFT','BOTTOM_RIGHT'];
export const ANCHORS_OUT = ['TOP_LEFT','TOP_MID','TOP_RIGHT','LEFT_MID','RIGHT_MID','BOTTOM_LEFT','BOTTOM_MID','BOTTOM_RIGHT'];
export const SCREEN = 360;

const P = {
  CENTER:[180,180], TOP_MID:[180,0], BOTTOM_MID:[180,360], LEFT_MID:[0,180], RIGHT_MID:[360,180],
  TOP_LEFT:[0,0], TOP_RIGHT:[360,0], BOTTOM_LEFT:[0,360], BOTTOM_RIGHT:[360,360]
};

export function parentPoint(anchor) { return P[anchor]; }

export function widgetPoint(anchor, x, y, w, h) {
  const px = anchor.includes('LEFT') ? x : anchor.includes('RIGHT') ? x + w : x + w / 2;
  const py = anchor.startsWith('TOP') ? y : anchor.startsWith('BOTTOM') ? y + h : y + h / 2;
  return [px, py];
}

// anchor doit être un membre de ANCHORS (pas de garde : enum interne contrôlé).
export function offsetFor(anchor, x, y, w, h) {
  const [wx, wy] = widgetPoint(anchor, x, y, w, h);
  return [Math.round(wx - P[anchor][0]), Math.round(wy - P[anchor][1])];
}

export function nearestAnchor(x, y, w, h) {
  let best = null, bd = Infinity;
  // Égalité départagée par l'ordre de ANCHORS (CENTER d'abord) ; ties pixel-exacts rares sur 360.
  for (const a of ANCHORS) {
    const [dx, dy] = offsetFor(a, x, y, w, h);
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

export function snapPlacement(x, y, w, h, snap = 16) {
  const anchor = nearestAnchor(x, y, w, h);
  let [dx, dy] = offsetFor(anchor, x, y, w, h);
  const snapped = Math.hypot(dx, dy) < snap;
  if (snapped) { dx = 0; dy = 0; }
  return { anchor, dx, dy, snapped };
}

export function placeAt(anchor, dx, dy, w, h) {
  const px = P[anchor][0] + dx, py = P[anchor][1] + dy;
  const x = px - (anchor.includes('LEFT') ? 0 : anchor.includes('RIGHT') ? w : w / 2);
  const y = py - (anchor.startsWith('TOP') ? 0 : anchor.startsWith('BOTTOM') ? h : h / 2);
  return { x: Math.round(x), y: Math.round(y) };
}

// Guide visuel d'ancrage (consommé par le canvas pendant le drag) : segment reliant le point
// d'ancrage du widget (à sa position écran x,y,w,h) au point d'ancrage parent de la même ancre.
// Quand le widget est pile sur l'ancre (offset nul, cf. snap), from == to → segment de longueur nulle.
export function anchorGuide(anchor, x, y, w, h) {
  return { from: widgetPoint(anchor, x, y, w, h), to: parentPoint(anchor) };
}

// --- Plan B : redimensionnement + conscience de l'écran rond (net-new, consommé par canvas.js) ---

// Bar : redim depuis la poignée bas-droite. dxPx/dyPx = déplacement pointeur en px écran (1:1).
export function resizeBox(startW, startH, dxPx, dyPx, min = 8) {
  return {
    width:  Math.max(min, Math.round(startW + dxPx)),
    height: Math.max(min, Math.round(startH + dyPx))
  };
}

// Ring : rayon = distance centre→pointeur (poignée bord externe).
export function ringRadiusAt(px, py, cx = SCREEN / 2, cy = SCREEN / 2, min = 8) {
  return Math.max(min, Math.round(Math.hypot(px - cx, py - cy)));
}

// Ring : épaisseur de bande = rayon − distance centre→pointeur (poignée bord interne).
export function ringThicknessAt(px, py, radius, cx = SCREEN / 2, cy = SCREEN / 2, min = 1) {
  return Math.max(min, Math.round(radius - Math.hypot(px - cx, py - cy)));
}

// Ring : ouverture = 2×|angle(pointeur) − bas|. L'ouverture est centrée en bas (90°,
// convention écran y-vers-le-bas = convention LVGL). cf. lv_arc_set_bg_angles (view.cpp:54).
export function gapDegAt(px, py, cx = SCREEN / 2, cy = SCREEN / 2) {
  const deg = Math.atan2(py - cy, px - cx) * 180 / Math.PI; // 0=droite, 90=bas
  const fromBottom = Math.abs(deg - 90);
  return Math.max(0, Math.min(180, Math.round(2 * fromBottom)));
}

// Écran rond / parent carré : un coin de la boîte sort-il du cercle visible
// (centre SCREEN/2, rayon SCREEN/2) ? Rappel pédagogique (spec § « écran rond »).
export function cornersOutsideCircle(x, y, w, h, screen = SCREEN) {
  const c = screen / 2, R = screen / 2;
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  return corners.some(([px, py]) => Math.hypot(px - c, py - c) > R);
}

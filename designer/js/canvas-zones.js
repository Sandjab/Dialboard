// Zones d'icônes autour de l'écran rond (remplace la palette verticale). 4 quadrants épousant l'écran,
// fonds concaves en path SVG (outline + coins arrondis), grilles d'icônes glissables (DnD inchangé :
// dragstart 'text/rt-type', le #stage reste la cible de drop — cf. palette.js).
// Géométrie FIGÉE (issue du playground canvas-sides, docs/_internal/) ; la mise à l'échelle responsive
// (fit colonne × zoom) est appliquée par app.js sur le #board. Coords board = px à l'échelle 1.
import { iconFor } from './icons.js';
import { COMPONENTS } from './registry.js';
import { t } from './i18n.js';
import { SCREEN } from './geometry.js';

// --- Paramètres validés (prompt playground) ---
const R = SCREEN / 2;                 // rayon écran (180)
const GUTTER = 56, GAPX = 120, GAPY = 4, CORNER = 25;
const COLS = 6, CHIP = 44, ICON_GAP = 10, PAD = 18;

// --- Géométrie dérivée du board (écran = 96 % de la hauteur ; largeur calée pour loger 6 colonnes) ---
const BAND = COLS * CHIP + (COLS - 1) * ICON_GAP + 2 * PAD;   // largeur de bande nécessaire (350)
export const BOARD_H = Math.round(SCREEN / 0.96);             // 375
const CY = BOARD_H / 2;
const INNER = Math.min(R + GUTTER, CY - 2);                   // rayon « creusé » (clampé par la demi-hauteur)
const CX = INNER + BAND;
export const BOARD_W = 2 * CX;
export const SCREEN_LEFT = CX - R, SCREEN_TOP = CY - R;       // position du #stage dans le board

const GX = Math.min(GAPX, INNER - 4);                         // écarts bornés (< rayon)
const GY = Math.min(GAPY, INNER - 4);
const VY = Math.sqrt(Math.max(0, INNER * INNER - GX * GX));   // intersection cercle / médiane verticale
const HX = Math.sqrt(Math.max(0, INNER * INNER - GY * GY));   // intersection cercle / médiane horizontale
const W = BOARD_W, H = BOARD_H;

// 4 quadrants : bande de pose des icônes (hors écran) + côté d'ancrage + clé i18n de famille.
// Chaque zone regroupe les composants d'UNE famille (mapping FAMILY explicite ci-dessous), pas une
// tranche mécanique de l'ordre du registre → les effecteurs restent groupés (« Effecteurs ») quel
// que soit l'ordre/le nombre de types. Le suffixe de la clé `family` = le nom de groupe (data/…).
const ZONES = [
  { id: 'TL', bandX0: 0,        bandX1: CX - INNER, y0: 0,       y1: CY - GY, side: 'left',  family: 'palette.family.data'      },
  { id: 'TR', bandX0: CX + INNER, bandX1: W,        y0: 0,       y1: CY - GY, side: 'right', family: 'palette.family.rich'      },
  { id: 'BL', bandX0: 0,        bandX1: CX - INNER, y0: CY + GY, y1: H,       side: 'left',  family: 'palette.family.effectors' },
  { id: 'BR', bandX0: CX + INNER, bandX1: W,        y0: CY + GY, y1: H,       side: 'right', family: 'palette.family.shapes'    },
];

// Sommets (sens horaire) ; un sommet `arc` = arête entrante tracée en arc de l'écran (rayon INNER).
function zoneVerts(id) {
  switch (id) {
    case 'TL': return [ {x:0,y:0},{x:CX-GX,y:0},{x:CX-GX,y:CY-VY},{x:CX-HX,y:CY-GY,arc:{sweep:0}},{x:0,y:CY-GY} ];
    case 'TR': return [ {x:W,y:0},{x:CX+GX,y:0},{x:CX+GX,y:CY-VY},{x:CX+HX,y:CY-GY,arc:{sweep:1}},{x:W,y:CY-GY} ];
    case 'BL': return [ {x:0,y:H},{x:CX-GX,y:H},{x:CX-GX,y:CY+VY},{x:CX-HX,y:CY+GY,arc:{sweep:1}},{x:0,y:CY+GY} ];
    case 'BR': return [ {x:W,y:H},{x:CX+GX,y:H},{x:CX+GX,y:CY+VY},{x:CX+HX,y:CY+GY,arc:{sweep:0}},{x:W,y:CY+GY} ];
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const towards = (V, T, r) => { const d = dist(V, T) || 1; return { x: V.x + (T.x - V.x) / d * r, y: V.y + (T.y - V.y) / d * r }; };

// Path d'une zone : coins droits arrondis (courbe quadratique de rayon CORNER, borné par les arêtes) ;
// arêtes `arc` émises en commande A (épousent l'écran), non arrondies.
function zonePath(id) {
  const verts = zoneVerts(id), n = verts.length;
  const arcIn = (i) => !!verts[i].arc;
  const node = verts.map((V, i) => {
    const P = verts[(i - 1 + n) % n], N = verts[(i + 1) % n];
    const ri = (arcIn(i) || arcIn((i + 1) % n)) ? 0 : Math.min(CORNER, 0.49 * dist(V, P), 0.49 * dist(V, N));
    return { V, ri, inPt: ri > 0 ? towards(V, P, ri) : V, outPt: ri > 0 ? towards(V, N, ri) : V };
  });
  const edge = (i, to) => arcIn(i) ? `A ${INNER} ${INNER} 0 0 ${verts[i].arc.sweep} ${to.x} ${to.y} ` : `L ${to.x} ${to.y} `;
  let d = `M ${node[0].inPt.x} ${node[0].inPt.y} `;
  if (node[0].ri > 0) d += `Q ${node[0].V.x} ${node[0].V.y} ${node[0].outPt.x} ${node[0].outPt.y} `;
  for (let i = 1; i < n; i++) {
    d += edge(i, node[i].inPt);
    if (node[i].ri > 0) d += `Q ${node[i].V.x} ${node[i].V.y} ${node[i].outPt.x} ${node[i].outPt.y} `;
  }
  d += edge(0, node[0].inPt) + 'Z';
  return d;
}

// Types glissables = composants non physiques, dans l'ordre du registre.
const TYPES = Object.entries(COMPONENTS).filter(([, d]) => !d.physical).map(([t, d]) => [t, d.label]);

// Famille de chaque type = quadrant de la palette. EXPLICITE (≠ tranche mécanique) : garantit que les
// effecteurs (saisie) restent groupés. Le nom de groupe = suffixe de la clé i18n `family` d'une ZONE.
// Un type absent de la carte retombe dans « shapes » (jamais perdu) ; l'ajouter ici pour le classer.
export const FAMILY = {
  label: 'data', readout: 'data', bar: 'data', chart: 'data', meter: 'data', ring: 'data', clock: 'data',
  image: 'rich', image_anim: 'rich', led: 'rich', icon: 'rich',
  switch: 'effectors', button: 'effectors', slider: 'effectors', arc: 'effectors', roller: 'effectors',
  rect: 'shapes', circle: 'shapes', line: 'shapes',
};

const NS = 'http://www.w3.org/2000/svg';

// Construit (ou reconstruit) les zones dans le board : taille du board, position du #stage, fonds SVG,
// grilles d'icônes glissables. Idempotent.
export function renderZones(board) {
  const stage = board.querySelector('#stage');
  const svg = board.querySelector('#zones-svg');
  board.style.width = BOARD_W + 'px';
  board.style.height = BOARD_H + 'px';
  stage.style.left = SCREEN_LEFT + 'px';
  stage.style.top = SCREEN_TOP + 'px';
  svg.setAttribute('width', BOARD_W); svg.setAttribute('height', BOARD_H);
  svg.setAttribute('viewBox', `0 0 ${BOARD_W} ${BOARD_H}`);

  svg.replaceChildren();
  for (const z of ZONES) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', zonePath(z.id));
    p.setAttribute('class', 'zone-shape');
    svg.appendChild(p);
  }

  board.querySelectorAll('.iconzone').forEach(n => n.remove());
  // Regroupe par famille (ordre du registre préservé au sein d'un quadrant). Type non classé → « shapes ».
  const slices = ZONES.map(z => TYPES.filter(([type]) => (FAMILY[type] || 'shapes') === z.family.split('.').pop()));
  ZONES.forEach((z, zi) => {
    const grid = document.createElement('div');
    grid.className = 'iconzone';
    grid.style.left = (z.bandX0 + PAD) + 'px';
    grid.style.top = (z.y0 + PAD) + 'px';
    grid.style.width = (z.bandX1 - z.bandX0 - 2 * PAD) + 'px';
    grid.style.height = (z.y1 - z.y0 - 2 * PAD) + 'px';
    grid.style.gridTemplateColumns = `repeat(${COLS}, ${CHIP}px)`;
    grid.style.gap = ICON_GAP + 'px';
    grid.style.direction = z.side === 'right' ? 'rtl' : 'ltr';   // panneaux droits : plaqués à droite (rangée incomplète comprise)
    if (slices[zi].length) {   // en-tête de famille (span pleine largeur ; côté = côté d'ancrage de la zone)
      const fam = document.createElement('div'); fam.className = 'zone-family';
      fam.textContent = t(z.family);
      fam.style.textAlign = z.side === 'right' ? 'right' : 'left';
      grid.appendChild(fam);
    }
    for (const [type, label] of slices[zi]) {
      const cell = document.createElement('div');
      cell.className = 'palette-item'; cell.draggable = true; cell.dataset.type = type; cell.title = t(label);
      cell.addEventListener('dragstart', e => e.dataTransfer.setData('text/rt-type', type));
      const chip = document.createElement('div'); chip.className = 'palette-chip';
      chip.style.width = chip.style.height = CHIP + 'px';
      const ic = iconFor(type); if (ic) chip.appendChild(ic);
      cell.appendChild(chip);
      const lbl = document.createElement('div'); lbl.className = 'palette-label'; lbl.textContent = t(label);
      cell.appendChild(lbl);
      grid.appendChild(cell);
    }
    board.appendChild(grid);
  });
}

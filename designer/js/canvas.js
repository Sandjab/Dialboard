// Canvas WYSIWYG : construit la page active depuis le modèle, gère sélection,
// drag + snap (commit-on-drop) et poignées de redimensionnement. Vérifié au navigateur.
import {
  snapPlacement, placeAt, resizeBox, anchorGuide, parentPoint, ANCHORS,
  ringRadiusAt, ringThicknessAt, gapDegAt, cornersOutsideCircle, SCREEN
} from './geometry.js';
import {
  ringPaths, pickThresholdColor
} from './render.js';
import { getMock } from './mocks.js';
import { COMPONENTS } from './registry.js';
import { effectivePageBg, effectivePageBgImage } from './mutations.js';
import { previewUrl } from './bg-image.js';
import { sourceFor, renderToAsset } from './image-asset.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Overlay SVG du guide d'ancrage, montré pendant un drag de widget. Repères statiques des 9 ancres,
// une ligne widget→ancre active et un marqueur sur l'ancre active (vert quand magnétisé). En unités
// écran (viewBox 0..360) : vit dans le .stage, donc scalé avec le zoom comme les widgets.
function createGuide() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'ag');
  svg.setAttribute('viewBox', `0 0 ${SCREEN} ${SCREEN}`);
  // Caché via l'attribut (sélecteur CSS `.ag[hidden]`) et NON la propriété `.hidden` : sur un
  // SVGElement la propriété n'est pas réfléchie en attribut, donc le guide resterait visible en
  // permanence. show()/hide() basculent donc l'attribut.
  svg.setAttribute('hidden', '');
  for (const a of ANCHORS) {                          // 9 repères fixes (un par point d'ancrage parent)
    const [px, py] = parentPoint(a);
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('class', 'ag-dot');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('r', 4);
    svg.appendChild(dot);
  }
  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('class', 'ag-line');
  const active = document.createElementNS(SVGNS, 'circle');
  active.setAttribute('class', 'ag-active');
  active.setAttribute('r', 6);
  svg.append(line, active);
  return {
    el: svg,
    show(anchor, fromX, fromY, snapped) {
      const [ax, ay] = parentPoint(anchor);
      line.setAttribute('x1', fromX); line.setAttribute('y1', fromY);
      line.setAttribute('x2', ax);    line.setAttribute('y2', ay);
      active.setAttribute('cx', ax);  active.setAttribute('cy', ay);
      active.classList.toggle('snapped', snapped);
      svg.removeAttribute('hidden');
    },
    hide() { svg.setAttribute('hidden', ''); }
  };
}

export function createCanvas({ stage }, model, { onSelect, onLiveMove } = {}) {
  let selected = null;    // index du placement sélectionné sur la page active
  let activePage = 0;     // page affichée par le canvas (source de vérité de l'éditeur, hors layout)

  const placements = () => model.state.pages?.[activePage]?.place ?? [];
  const comps = () => model.state.components || {};
  const nodeFor = i => stage.querySelector(`.w[data-pi="${i}"]`);
  // Facteur de zoom d'affichage courant : le .stage est scalé en CSS (transform), donc sa largeur
  // mesurée vaut 360 × zoom. Toute coord lue depuis le pointeur ou getBoundingClientRect() est en px
  // viewport (post-transform) et doit être ramenée en unités écran en divisant par ce facteur.
  const zoomScale = () => stage.getBoundingClientRect().width / SCREEN;

  // Guide d'ancrage : créé une fois, survit aux render() (qui ne retirent que les .w) ; affiché pendant le drag.
  const guide = createGuide();
  stage.appendChild(guide.el);

  function buildNode(pl, comp) {
    return COMPONENTS[comp.type].build(comp, pl, getMock(pl.ref, comp.type));
  }

  function position(node, pl, comp) {
    if (COMPONENTS[comp.type].centered) {                 // centré, ignore anchor/dx/dy
      const r = pl.radius || 80;
      node.style.left = (SCREEN / 2 - r) + 'px';
      node.style.top  = (SCREEN / 2 - r) + 'px';
      return;
    }
    const s = zoomScale();
    const rect = node.getBoundingClientRect();      // px viewport (à l'échelle du zoom)
    const w = rect.width / s, h = rect.height / s;   // → unités écran
    const { x, y } = placeAt(pl.anchor || 'CENTER', pl.dx || 0, pl.dy || 0, w, h);
    node.style.left = x + 'px';
    node.style.top  = y + 'px';
    node.classList.toggle('outside', cornersOutsideCircle(x, y, w, h));
  }

  function render() {
    stage.querySelectorAll('.w').forEach(n => n.remove());
    stage.style.background = effectivePageBg(model.state, activePage);   // fond de page (override) ou global
    // Image de fond (prime sur la couleur). Apercu depuis le cache ; vide si la cle n'a pas d'octets
    // charges (ex. apres rechargement avant un « Charger » depuis le device) -> la couleur reste visible.
    const bgImgKey = effectivePageBgImage(model.state, activePage);
    const bgImgUrl = bgImgKey ? previewUrl(bgImgKey) : null;
    stage.style.backgroundImage = bgImgUrl ? `url(${bgImgUrl})` : '';
    stage.style.backgroundSize = 'cover';
    stage.style.backgroundPosition = 'center';
    placements().forEach((pl, i) => {
      const comp = comps()[pl.ref];
      if (!comp) return;                         // ref inconnue : la validation le signale déjà
      const def = COMPONENTS[comp.type];
      if (!def) return;                          // type inconnu : signalé par la validation, on ne le dessine pas (repli défini, pas un buildLabel silencieux)
      if (def.physical) return;   // physiques édités dans le panneau « Device » ; jamais rendus sur une page
      const node = buildNode(pl, comp);
      node.dataset.pi = i;
      node.dataset.ref = pl.ref;               // permet la lookup par ref (ex: apercu image_anim)
      stage.appendChild(node);                   // append avant de mesurer
      position(node, pl, comp);
      node.addEventListener('pointerdown', e => onPointerDown(e, i, node, comp));
    });
    applySelection();
  }

  function applySelection() {
    stage.querySelectorAll('.w.selected').forEach(n => n.classList.remove('selected'));
    stage.querySelectorAll('.handle').forEach(n => n.remove());
    if (selected == null) return;
    const node = nodeFor(selected);
    if (!node) { selected = null; return; }
    node.classList.add('selected');
    const pl = placements()[selected];
    const comp = comps()[pl.ref];
    if (comp.type === 'bar')  addBarHandles(node, selected, pl);
    if (comp.type === 'ring') addRingHandles(node, selected, comp, pl);
    if (comp.type === 'image') addImageHandles(node, pl, comp);
  }

  function select(i) {
    selected = i;
    applySelection();
    onSelect && onSelect(i == null ? null : { placeIndex: i, ref: placements()[i].ref });
  }

  // --- Drag (label/readout/bar) : aperçu live, UN SEUL commit au drop (piège HANDOFF a) ---
  function onPointerDown(e, i, node, comp) {
    if (e.target.classList.contains('handle')) return; // laisser le resize gérer
    select(i);
    const def = COMPONENTS[comp.type];
    if (def.centered || def.physical) return;             // ring centré / physique : non déplaçable
    e.preventDefault();
    const s = zoomScale();                          // constant durant le geste (le zoom ne change pas en plein drag)
    const sr = stage.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    const grabX = (e.clientX - nr.left) / s, grabY = (e.clientY - nr.top) / s;
    const w = nr.width / s, h = nr.height / s;
    node.setPointerCapture(e.pointerId);
    let live = null;
    const move = ev => {
      const x = (ev.clientX - sr.left) / s - grabX;
      const y = (ev.clientY - sr.top)  / s - grabY;
      live = snapPlacement(x, y, w, h, 16);
      const p = placeAt(live.anchor, live.dx, live.dy, w, h);
      node.style.left = p.x + 'px'; node.style.top = p.y + 'px';
      node.classList.toggle('snapped', live.snapped);
      node.classList.toggle('outside', cornersOutsideCircle(p.x, p.y, w, h));
      const { from } = anchorGuide(live.anchor, p.x, p.y, w, h);  // point d'ancrage du widget affiché
      guide.show(live.anchor, from[0], from[1], live.snapped);
      onLiveMove && onLiveMove({ anchor: live.anchor, dx: live.dx, dy: live.dy });  // inspecteur live, sans commit
    };
    const up = () => {
      node.releasePointerCapture(e.pointerId);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.classList.remove('snapped');
      guide.hide();
      if (live) model.commit(s => {                    // commit unique, pas par frame
        const q = s.pages[activePage].place[i];
        q.anchor = live.anchor; q.dx = live.dx; q.dy = live.dy;
      });
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
  }

  // --- Resize bar : poignée bas-droite → width/height ---
  function addBarHandles(node, i, pl) {
    const h = document.createElement('div');
    h.className = 'handle handle-br';
    node.appendChild(h);
    h.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const s = zoomScale();
      const startW = pl.width || 200, startH = pl.height || 16;
      const sx = e.clientX, sy = e.clientY;
      const track = node.querySelector('.w-bar-track');
      h.setPointerCapture(e.pointerId);
      let dim = null;
      const move = ev => {
        dim = resizeBox(startW, startH, (ev.clientX - sx) / s, (ev.clientY - sy) / s, 8);
        track.style.width = dim.width + 'px'; track.style.height = dim.height + 'px';
      };
      const up = () => {
        h.releasePointerCapture(e.pointerId);
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
        if (dim) model.commit(s => { const q = s.pages[activePage].place[i]; q.width = dim.width; q.height = dim.height; });
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
  }

  // --- Resize image : poignee bas-droite -> component.w/h (la taille vit sur le composant). Au drop,
  // re-rasterise la source a la nouvelle taille (etirement libre) -> nouvelle cle `src`, gardant l'asset
  // coherent avec w×h. Sans source memorisee (ex. asset jamais charge), on met juste a jour w/h.
  function addImageHandles(node, pl, comp) {
    const h = document.createElement('div');
    h.className = 'handle handle-br';
    node.appendChild(h);
    h.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const s = zoomScale();
      const startW = comp.w || 120, startH = comp.h || 120;
      const sx = e.clientX, sy = e.clientY;
      h.setPointerCapture(e.pointerId);
      let dim = null;
      const move = ev => {
        dim = resizeBox(startW, startH, (ev.clientX - sx) / s, (ev.clientY - sy) / s, 8);
        node.style.width = dim.width + 'px'; node.style.height = dim.height + 'px';
        const img = node.querySelector('img'); if (img) { img.style.width = '100%'; img.style.height = '100%'; }
      };
      const up = () => {
        h.releasePointerCapture(e.pointerId);
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
        if (!dim) return;
        const src = sourceFor(pl.ref);
        const key = src ? renderToAsset(src, dim.width, dim.height).key : null;
        model.commit(st => {
          const c = st.components[pl.ref];
          c.w = dim.width; c.h = dim.height;
          if (key) c.src = key;   // garde src <-> w×h coherent ; sans source on ne touche pas src
        });
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
  }

  // --- Resize ring : 3 poignées (radius / thickness / gap_deg), aperçu live, commit au drop ---
  function positionRingHandles(node, g) {
    const c = g.r; // centre dans le repère du wrap (taille 2r)
    const set = (sel, x, y) => { const el = node.querySelector(sel); if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; } };
    set('.handle-radius', c, c - g.r);            // bord externe, haut
    set('.handle-thick',  c, c - g.r + g.th);     // bord interne, haut
    const a = (90 + g.gap / 2) * Math.PI / 180;   // extrémité de l'ouverture (bas)
    set('.handle-gap', c + g.r * Math.cos(a), c + g.r * Math.sin(a));
  }

  function paintRing(node, comp, g, mockVal) {
    const size = g.r * 2;
    node.style.width = size + 'px'; node.style.height = size + 'px';
    node.style.left = (SCREEN / 2 - g.r) + 'px'; node.style.top = (SCREEN / 2 - g.r) + 'px';
    const svg = node.querySelector('svg');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    const p = ringPaths(g.r, g.th, g.gap, mockVal, comp.min ?? 0, comp.max ?? 100);
    const col = pickThresholdColor(comp.thresholds, mockVal, comp.color || '#38BDF8');
    const t = svg.querySelector('.ring-track'), ind = svg.querySelector('.ring-ind');
    t.setAttribute('d', p.track); t.setAttribute('stroke-width', g.th);
    ind.setAttribute('d', p.indicator); ind.setAttribute('stroke-width', g.th); ind.setAttribute('stroke', col);
    const pill = node.querySelector('.w-ring-pill'); if (pill) pill.style.top = (g.th / 2) + 'px';
    const cap = node.querySelector('.w-ring-cap');   if (cap)  cap.style.bottom = g.th + 'px';
    positionRingHandles(node, g);
  }

  function addRingHandles(node, i, comp, pl) {
    const geo = () => ({ r: pl.radius || 80, th: pl.thickness || 16, gap: pl.gap_deg ?? 70 });
    for (const kind of ['radius', 'thick', 'gap']) {
      const h = document.createElement('div');
      h.className = 'handle handle-' + kind;
      node.appendChild(h);
      h.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        const s = zoomScale();
        const sr = stage.getBoundingClientRect();
        h.setPointerCapture(e.pointerId);
        let g = geo();
        let moved = false;
        const move = ev => {
          moved = true;
          const px = (ev.clientX - sr.left) / s, py = (ev.clientY - sr.top) / s; // → unités écran
          const base = geo();
          if (kind === 'radius')      g = { ...base, r:  ringRadiusAt(px, py) };
          else if (kind === 'thick')  g = { ...base, th: ringThicknessAt(px, py, base.r) };
          else                        g = { ...base, gap: gapDegAt(px, py) };
          paintRing(node, comp, g, getMock(pl.ref, 'ring').value);
        };
        const up = () => {
          h.releasePointerCapture(e.pointerId);
          h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up);
          if (moved) model.commit(s => {
            const q = s.pages[activePage].place[i];
            q.radius = g.r; q.thickness = g.th; q.gap_deg = g.gap;
          });
        };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
    }
    positionRingHandles(node, geo());
  }

  // Clic dans le vide (fond ou liseré) → désélection.
  stage.addEventListener('pointerdown', e => {
    if (e.target === stage || e.target.classList.contains('screen-circle')) select(null);
  });

  // Change la page affichée. On désélectionne (un index de placement n'a pas de sens d'une page à
  // l'autre — cf. Décisions C2, on désélectionne plutôt que de re-keyer) puis on re-rend.
  function setPage(i) {
    activePage = i;
    selected = null;
    render();
    onSelect && onSelect(null);
  }

  model.subscribe(render);
  render();
  // La webfont Montserrat (font-display:swap) charge en asynchrone : le 1er render mesure
  // avant le swap → centrage à ~8px près. Re-render une fois la police prête (fidélité).
  if (document.fonts?.ready) document.fonts.ready.then(render);
  return { render, getSelected: () => selected, selectPlacement: select, setPage, getActivePage: () => activePage };
}

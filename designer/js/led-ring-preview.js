// Aperçu de l'anneau LED physique (13 WS2812). Fonctions PURES (ledFrame/ledFrameAt, testées node) +
// peintre DOM (paintRing) + brancheur canvas (createLedRingPreview). Miroir de src/led_ring_comp.cpp :
// progress = round(value%*13) ; spinner = tête now/(period/N)%N ; blink duty 50% ; breathe 0.5*(1-cos).
import { getMock } from './mocks.js';

export const LED_RING_COUNT = 13;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Frame statique représentative : ce que montrent les LEDs « au repos » pour ce mode.
export function ledFrame(comp, mock = {}) {
  const N = LED_RING_COUNT;
  const color = comp?.color || '#FFFFFF';
  const alpha = clamp(comp?.brightness ?? 64, 0, 255) / 255;
  const mode = comp?.mode || 'off';
  const on = new Array(N).fill(false);
  if (mode === 'solid' || mode === 'blink' || mode === 'breathe') on.fill(true);
  else if (mode === 'progress') {
    const lit = Math.round(clamp(mock.value ?? 0, 0, 100) / 100 * N);
    for (let i = 0; i < lit; i++) on[i] = true;
  } else if (mode === 'spinner') on[0] = true;
  // off → tout éteint
  return { color, alpha, on, mode };
}

// Frame ANIMÉE à l'instant nowMs (pour le bouton ▶ Aperçu). Surcharge ledFrame pour les modes animés.
export function ledFrameAt(comp, mock, nowMs) {
  const f = ledFrame(comp, mock);
  const N = LED_RING_COUNT;
  const period = Math.max(1, comp?.period_ms ?? 1000);
  if (f.mode === 'spinner') {
    const head = Math.floor(nowMs / (period / N)) % N;
    f.on = f.on.map((_, i) => i === head);
  } else if (f.mode === 'blink') {
    const onNow = (nowMs % period) < period / 2;
    f.on = f.on.map(() => onNow);
  } else if (f.mode === 'breathe') {
    const ph = (nowMs % period) / period;
    f.alpha = f.alpha * 0.5 * (1 - Math.cos(ph * 2 * Math.PI));
  }
  return f;
}

// Peint 13 pastilles positionnées en cercle dans `container`. Idempotent (remplace le contenu).
// Taille des pastilles : via CSS (selon le conteneur .led-ring-canvas / .led-ring-mini).
export function paintRing(container, frame) {
  const { color, alpha, on } = frame;
  const N = LED_RING_COUNT, R = 49;   // rayon en % du conteneur
  container.replaceChildren();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI - Math.PI / 2;   // départ en haut
    const dot = document.createElement('span');
    dot.className = 'led-dot' + (on[i] ? ' on' : '');
    dot.style.left = (50 + R * Math.cos(a)) + '%';
    dot.style.top  = (50 + R * Math.sin(a)) + '%';
    if (on[i]) { dot.style.background = color; dot.style.opacity = String(alpha); dot.style.boxShadow = `0 0 6px ${color}`; }
    container.appendChild(dot);
  }
}

// Trouve le led_ring singleton dans l'état, ou null.
export function findLedRing(state) {
  const comps = state.components || {};
  const id = Object.keys(comps).find(k => comps[k].type === 'led_ring');
  return id ? { id, comp: comps[id] } : null;
}

// Brancheur du liseré du canvas : repeint (frame STATIQUE) à chaque changement du modèle. Exposé `render`
// pour rafraîchir aussi sur une édition de mock (appelé par le panneau Device). Sans led_ring → anneau éteint.
export function createLedRingPreview({ host }, model) {
  function render() {
    const r = findLedRing(model.state);
    paintRing(host, r ? ledFrame(r.comp, getMock(r.id, 'led_ring')) : ledFrame({ mode: 'off' }));
  }
  model.subscribe(render);
  render();
  return { render };
}

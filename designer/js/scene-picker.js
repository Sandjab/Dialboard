// Overlay de sélection de scène : grille de vignettes ANIMÉES (une boucle rAF par vignette, arrêtée
// à la fermeture). Calque de icon-picker.js (singleton, overlay transitoire, Escape/backdrop close).
import { SCENES, SCENE_NAMES, sceneFrameAt, sceneLayerColor } from './scenes.js';
import { ICON_CHAR } from './render.js';
import { t } from './i18n.js';

let _open = null;   // { overlay, onKey, raf }

export function closeScenePicker() {
  if (!_open) return;
  cancelAnimationFrame(_open.raf);
  document.removeEventListener('keydown', _open.onKey);
  _open.overlay.remove();
  _open = null;
}

export function openScenePicker({ current = null, onPick } = {}) {
  closeScenePicker();
  const overlay = document.createElement('div');
  overlay.className = 'shot-overlay iconpick-overlay';
  const box = document.createElement('div'); box.className = 'iconpick-box';
  overlay.appendChild(box);
  const bar = document.createElement('div'); bar.className = 'iconpick-bar';
  const title = document.createElement('span'); title.textContent = t('scenepicker.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'iconpick-close'; closeBtn.type = 'button'; closeBtn.textContent = '×';
  bar.append(title, closeBtn); box.appendChild(bar);
  const grid = document.createElement('div'); grid.className = 'iconpick-grid scenepick-grid';
  box.appendChild(grid);

  const pick = name => { closeScenePicker(); onPick?.(name); };
  const nodes = [];   // { name, wrap } pour l'animation
  for (const name of SCENE_NAMES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'iconpick-item' + (name === current ? ' sel' : '');
    b.title = t('scene.' + name);
    const wrap = document.createElement('div'); wrap.className = 'scenepick-thumb'; wrap.style.position = 'relative';
    SCENES[name].layers.forEach(L => {
      const el = document.createElement('i');
      el.className = 'mdi w-scene-layer';
      el.textContent = ICON_CHAR[L.symbol] || '';
      el.style.position = 'absolute'; el.style.left = '50%'; el.style.top = '50%';
      el.style.fontSize = Math.round(L.scaleRel * 44) + 'px';
      el.style.color = sceneLayerColor(L, SCENES[name].color);
      el.style.transformOrigin = (L.anim === 'swing') ? 'center top' : 'center center';
      wrap.appendChild(el);
    });
    const lbl = document.createElement('span'); lbl.className = 'iconpick-name'; lbl.textContent = t('scene.' + name);
    b.append(wrap, lbl);
    b.addEventListener('click', () => pick(name));
    grid.appendChild(b);
    nodes.push({ name, wrap });
  }

  // Anime toutes les vignettes dans une seule boucle rAF (arrêtée à la fermeture via _open.raf).
  const paint = () => {
    for (const { name, wrap } of nodes) {
      const fr = sceneFrameAt(name, performance.now());
      const layers = wrap.querySelectorAll('.w-scene-layer');
      fr.forEach((f, i) => {
        const el = layers[i]; if (!el) return;
        const dx = (f.cx - 50) / 100 * 44, dy = (f.cy - 50) / 100 * 44;
        el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${f.angleDdeg / 10}deg) scale(${f.scale})`;
        el.style.opacity = String(f.opa / 255);
      });
    }
    if (_open) _open.raf = requestAnimationFrame(paint);
  };

  closeBtn.addEventListener('click', () => closeScenePicker());
  overlay.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === overlay) closeScenePicker(); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeScenePicker(); } };
  document.addEventListener('keydown', onKey);
  _open = { overlay, onKey, raf: 0 };
  document.body.appendChild(overlay);
  _open.raf = requestAnimationFrame(paint);
}

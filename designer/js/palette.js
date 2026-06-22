// Palette : 6 créateurs de type — glisser un type sur le #stage crée un composant + un placement
// au point de dépôt, sur la page ACTIVE, puis sélection du nouveau placement. Modèle 1:1 : un
// composant = un placement ; pour réutiliser un widget, copier/coller (cross-page) ou dupliquer un
// placement (cf. app.js/shortcuts.js). Drop = UN commit. (Pages = tree.js ; aperçu = mocks.js.)
import { uniqueId, addComponent, addPlacement } from './mutations.js';
import { COMPONENTS } from './registry.js';
import { iconFor } from './icons.js';
import { SCREEN } from './geometry.js';

export function createPalette(root, model, { stage, getActivePage, onCreated } = {}) {
  const page = () => (getActivePage ? getActivePage() : 0);

  // Indice : le geste central (glisser-déposer sur l'écran) n'est pas évident sans mode d'emploi.
  const hint = document.createElement('div');
  hint.className = 'palette-hint';
  hint.textContent = 'Glisse un élément sur l’écran pour créer un composant.';
  root.appendChild(hint);

  // --- Section créateurs de type (statique) ---
  const list = document.createElement('div');
  list.className = 'palette-list';
  for (const [type, def] of Object.entries(COMPONENTS)) {
    if (def.physical) continue;   // physiques : édités dans le panneau « Device », pas glissables sur une page
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.dataset.type = type;
    const ic = iconFor(type); if (ic) item.appendChild(ic);   // icône de type (décorative)
    const lbl = document.createElement('span'); lbl.textContent = def.label;
    item.appendChild(lbl);
    item.addEventListener('dragstart', e => e.dataTransfer.setData('text/rt-type', type));
    list.appendChild(item);
  }
  root.appendChild(list);

  // --- Cible de drop : crée un composant du type glissé, sur la page active ---
  stage.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/rt-type')) { e.preventDefault(); stage.classList.add('drop-active'); }
  });
  // relatedTarget hors du stage = on quitte vraiment la cible (pas un passage sur un enfant).
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drop-active'); });
  stage.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('text/rt-type');
    stage.classList.remove('drop-active');
    if (!type) return;
    if (COMPONENTS[type]?.physical) return;               // type physique : pas de placement
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const s = r.width / SCREEN;                            // zoom d'affichage : ramener le drop en unités écran
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    const pi = page();
    let newIndex;
    model.commit(s => {
      const id = uniqueId(s, type);
      addComponent(s, id, COMPONENTS[type].defaults());
      addPlacement(s, pi, COMPONENTS[type].makePlacement(id, x, y));
      newIndex = s.pages[pi].place.length - 1;
    });
    if (newIndex != null) onCreated && onCreated(newIndex);
  });
}

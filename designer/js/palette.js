// Palette : (1) 6 créateurs de type — glisser sur le #stage crée un composant + un placement au point
// de dépôt ; (2) Bibliothèque des composants déjà définis — glisser un existant sur le #stage le PLACE
// (partage : même id/état, pas une copie) sur la page ACTIVE. Drop = UN commit, puis sélection du
// nouveau placement. Vérifié au navigateur. (Pages = pages.js ; valeurs d'aperçu = mocks.js.)
import { uniqueId, addComponent, addPlacement } from './mutations.js';
import { COMPONENTS } from './registry.js';
import { iconFor } from './icons.js';
import { SCREEN } from './geometry.js';

export function createPalette(root, model, { stage, getActivePage, onCreated } = {}) {
  const page = () => (getActivePage ? getActivePage() : 0);

  // Indice : le geste central (glisser-déposer sur l'écran) n'est pas évident sans mode d'emploi.
  const hint = document.createElement('div');
  hint.className = 'palette-hint';
  hint.textContent = 'Glisse un élément sur l’écran pour l’ajouter.';
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

  // --- Section bibliothèque (dynamique : reflète components) ---
  const libTitle = document.createElement('div');
  libTitle.className = 'lib-title';
  libTitle.textContent = 'Bibliothèque';
  root.appendChild(libTitle);
  const libList = document.createElement('div');
  libList.className = 'lib-list';
  root.appendChild(libList);

  function renderLibrary() {
    libList.replaceChildren();
    const comps = model.state.components || {};
    const ids = Object.keys(comps).filter(id => !COMPONENTS[comps[id].type]?.physical);
    if (!ids.length) {
      const empty = document.createElement('div');
      empty.className = 'lib-empty';
      empty.textContent = 'Aucun composant défini.';
      libList.appendChild(empty);
      return;
    }
    for (const id of ids) {
      const item = document.createElement('div');
      item.className = 'lib-item';
      item.draggable = true;
      const ic = iconFor(comps[id].type); if (ic) item.appendChild(ic);   // même jeu d'icônes que les types
      const name = document.createElement('span'); name.textContent = id;
      const type = document.createElement('span'); type.className = 'lib-type'; type.textContent = comps[id].type;
      item.appendChild(name); item.appendChild(type);
      item.addEventListener('dragstart', e => e.dataTransfer.setData('text/rt-ref', id));
      libList.appendChild(item);
    }
  }
  model.subscribe(renderLibrary);
  renderLibrary();

  // --- Cible de drop : crée (type) ou place un existant (ref), sur la page active ---
  stage.addEventListener('dragover', e => {
    const t = e.dataTransfer.types;
    if (t.includes('text/rt-type') || t.includes('text/rt-ref')) { e.preventDefault(); stage.classList.add('drop-active'); }
  });
  // relatedTarget hors du stage = on quitte vraiment la cible (pas un passage sur un enfant).
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drop-active'); });
  stage.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('text/rt-type');
    const ref = e.dataTransfer.getData('text/rt-ref');
    stage.classList.remove('drop-active');
    if (!type && !ref) return;
    if (type && COMPONENTS[type]?.physical) return;                       // type physique : pas de placement
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const s = r.width / SCREEN;                            // zoom d'affichage : ramener le drop en unités écran
    const x = (e.clientX - r.left) / s, y = (e.clientY - r.top) / s;
    const pi = page();
    let newIndex;
    model.commit(s => {
      if (type) {
        const id = uniqueId(s, type);
        addComponent(s, id, COMPONENTS[type].defaults());
        addPlacement(s, pi, COMPONENTS[type].makePlacement(id, x, y));
      } else {
        const existing = s.components[ref];
        if (!existing || COMPONENTS[existing.type]?.physical) return;     // ref disparue / physique : pas de placement
        addPlacement(s, pi, COMPONENTS[existing.type].makePlacement(ref, x, y));
      }
      newIndex = s.pages[pi].place.length - 1;
    });
    if (newIndex != null) onCreated && onCreated(newIndex);
  });
}

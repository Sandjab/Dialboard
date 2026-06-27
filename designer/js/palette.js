// Palette disposée en 4 zones autour de l'écran (rendu : canvas-zones.js). Ce module garde la logique de
// DÉPÔT : glisser une icône de type sur le #stage crée un composant + un placement au point de dépôt, sur
// la page active, puis sélection du nouveau placement. Drop = UN commit. (Pages = tree.js ; aperçu = mocks.js.)
import { uniqueId, addComponent, addPlacement } from './mutations.js';
import { COMPONENTS } from './registry.js';
import { SCREEN } from './geometry.js';
import { logs } from './logs.js';
import { renderZones } from './canvas-zones.js';

export function createPalette(board, model, { stage, getActivePage, onCreated } = {}) {
  const page = () => (getActivePage ? getActivePage() : 0);

  renderZones(board);   // 4 zones d'icônes glissables autour de l'écran

  // Cible de drop : le #stage (l'écran rond). Le rect live (÷ SCREEN) donne le facteur d'échelle courant,
  // donc le dépôt reste correct quelle que soit la mise à l'échelle responsive/zoom du board.
  stage.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/rt-type')) { e.preventDefault(); stage.classList.add('drop-active'); }
  });
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('drop-active'); });
  stage.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('text/rt-type');
    stage.classList.remove('drop-active');
    if (!type) return;
    if (COMPONENTS[type]?.physical) return;               // type physique : pas de placement
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const sc = r.width / SCREEN;                           // facteur d'échelle d'affichage → coords écran
    const x = (e.clientX - r.left) / sc, y = (e.clientY - r.top) / sc;
    const pi = page();
    let newIndex;
    model.commit(s => {
      const id = uniqueId(s, type);
      addComponent(s, id, COMPONENTS[type].defaults());
      addPlacement(s, pi, COMPONENTS[type].makePlacement(id, x, y));
      newIndex = s.pages[pi].place.length - 1;
    });
    if (newIndex != null) { onCreated && onCreated(newIndex); logs.logActivity('Composant ajouté : ' + type); }
  });
}

// Miniature live d'un layout (page 0). Réutilise les builders du registre + la géométrie du canvas,
// SANS toucher canvas.js (sélection/poignées/guides). Mesure les nœuds attachés dans un hôte
// « visibility:hidden » (display:none donnerait des tailles nulles) puis positionne comme canvas.js.
// La réduction (transform:scale) est appliquée APRÈS la mesure : le transform d'un ancêtre se propage
// aux getBoundingClientRect des descendants, donc mesurer avant réduit fausserait le placement.
import { COMPONENTS } from './registry.js';
import { placeAt, SCREEN } from './geometry.js';
import { MOCKS } from './render.js';

// Hôte de mesure : rendu (layout calculé) mais invisible, hors flux.
let measureHost = null;
function ensureMeasureHost() {
  if (!measureHost) {
    measureHost = document.createElement('div');
    measureHost.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(measureHost);
  }
  return measureHost;
}

// Renvoie un <div.tpl-thumb> contenant un stage 360×360 réduit par `scale`.
export function buildThumbnail(layout, { scale = 0.42 } = {}) {
  const comps = layout.components || {};
  const page = (Array.isArray(layout.pages) && layout.pages[0]) || { place: [] };

  const stage = document.createElement('div');
  stage.className = 'tpl-thumb-stage';
  stage.style.width = stage.style.height = SCREEN + 'px';
  stage.style.background = page.background || layout.background || '#000';   // override de page 0 comme le canvas
  // NB : les images de fond de page (background_image) ne sont pas rendues en miniature (pas de cache d'assets ici).

  // 1) construire + attacher dans l'hôte de mesure (stage NON encore réduit : mesure en unités écran)
  ensureMeasureHost().appendChild(stage);
  const placed = [];
  for (const pl of (Array.isArray(page.place) ? page.place : [])) {
    const comp = comps[pl.ref];
    if (!comp) continue;
    const def = COMPONENTS[comp.type];
    if (!def || def.physical) continue;
    const node = def.build(comp, pl, structuredClone(MOCKS[comp.type] ?? {}));   // clone : un builder ne doit pas muter le défaut partagé
    node.classList.toggle('hidden', comp.visible === false);   // parité canvas : visible:false grisé
    stage.appendChild(node);
    placed.push({ node, pl, def });
  }
  // 2) positionner (mesure fiable : stage attaché, non réduit, visibility:hidden ⇒ layout calculé)
  for (const { node, pl, def } of placed) {
    if (def.centered) {
      const r = pl.radius || 80;
      node.style.left = (SCREEN / 2 - r) + 'px';
      node.style.top  = (SCREEN / 2 - r) + 'px';
    } else {
      const rect = node.getBoundingClientRect();   // stage à scale 1 ⇒ px = unités écran
      const { x, y } = placeAt(pl.anchor || 'CENTER', pl.dx || 0, pl.dy || 0, rect.width, rect.height);
      node.style.left = x + 'px';
      node.style.top  = y + 'px';
    }
  }

  // 3) réduire (APRÈS mesure), sortir de l'hôte de mesure, emballer à la taille réduite
  stage.style.transform = `scale(${scale})`;
  stage.style.transformOrigin = 'top left';
  const wrap = document.createElement('div');
  wrap.className = 'tpl-thumb';
  wrap.style.width = (SCREEN * scale) + 'px';
  wrap.style.height = (SCREEN * scale) + 'px';
  wrap.appendChild(stage);   // déplace le stage (retiré de measureHost)
  return wrap;
}

// Carousel de vignettes de pages (sous le hero disque) : navigation visuelle rapide.
// Vue de plus sur le modèle (abonnée model + selection), comme l'arbre/canvas.
// La math/décisions pures sont ici (testées node) ; le rendu DOM est vérifié au navigateur.

import { COMPONENTS } from './registry.js';
import { placeAt, SCREEN } from './geometry.js';
import { getMock } from './mocks.js';
import { addPage, uniquePageName, reorderPages, duplicatePage, removePage, renamePage, pageNameTaken } from './mutations.js';
import { contextMenuItems, openContextMenu } from './contextmenu.js';

// Miroir de src/config.h:3 (#define MAX_PAGES 8) et de designer/js/validate.js:27 (LIM.pages).
export const MAX_PAGES = 8;

// Peut-on encore ajouter une page ? (borne le bouton « + page »)
export function canAddPage(state, max = MAX_PAGES) {
  return (state?.pages?.length ?? 0) < max;
}

// État des flèches de défilement selon la position de scroll de la bande.
// Tolérance d'1px pour absorber les arrondis sub-pixel de scrollWidth/clientWidth.
export function arrowState({ scrollLeft, scrollWidth, clientWidth }) {
  return {
    left: scrollLeft > 0,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

// Rend une page entière en read-only dans un mini-stage 360×360 (mêmes builders + placement que le
// canvas, sans sélection/poignées/preview). L'appelant (carousel) attache l'élément au DOM puis le
// scale (transform) à la taille de la vignette. Composants `physical` ignorés (cf. canvas.render).
// DOIT être attaché au DOM avant lecture des tailles : le placement non-centré mesure le widget.
export function buildPageStatic(page, comps) {
  const mini = document.createElement('div');
  mini.className = 'mini-stage';
  mini.style.width = SCREEN + 'px';
  mini.style.height = SCREEN + 'px';
  mini.style.position = 'relative';
  const place = page?.place ?? [];
  // Phase 1 : construire + attacher (pour pouvoir mesurer).
  const built = [];
  for (const pl of place) {
    const comp = comps?.[pl.ref];
    if (!comp) continue;                 // ref inconnue : la validation le signale déjà
    const def = COMPONENTS[comp.type];
    if (!def || def.physical) continue;  // type inconnu / sortie physique : pas dessiné sur une page
    const node = def.build(comp, pl, getMock(pl.ref, comp.type));
    mini.appendChild(node);
    built.push({ node, pl, def });
  }
  // Phase 2 : positionner (mesure à l'échelle 1, le carousel scale le conteneur ensuite).
  // Attacher hors-écran pour mesurer (un nœud détaché rend 0×0 → placement non-centré faux).
  mini.style.position = 'fixed'; mini.style.left = '-99999px'; mini.style.top = '0';
  document.body.appendChild(mini);
  for (const { node, pl, def } of built) {
    if (def.centered) {
      const r = pl.radius || 80;
      node.style.left = (SCREEN / 2 - r) + 'px';
      node.style.top  = (SCREEN / 2 - r) + 'px';
    } else {
      const rect = node.getBoundingClientRect();
      const { x, y } = placeAt(pl.anchor || 'CENTER', pl.dx || 0, pl.dy || 0, rect.width, rect.height);
      node.style.left = x + 'px';
      node.style.top  = y + 'px';
    }
  }
  document.body.removeChild(mini);
  mini.style.position = 'relative'; mini.style.left = ''; mini.style.top = '';
  return mini;
}

const THUMB = 72;   // diamètre d'une vignette (px)
let dragFrom = null; // index source d'un glisser-déposer en cours (null = pas de drag)
let renaming = null; // index de la page en cours de renommage inline, ou null

// host : élément #carousel ; deps : sélection partagée + accès page active (comme l'arbre).
export function createCarousel({ host }, model, { selection, setSelection, getActivePage, setPage }) {
  // Supprime les marqueurs de dépôt sur toutes les vignettes.
  function clearDropMarks() {
    host.querySelectorAll('.caro-drop').forEach(n => n.classList.remove('caro-drop'));
  }

  // Construit une vignette (disque) pour la page d'index i.
  function thumb(page, i, active) {
    const cell = document.createElement('div');
    cell.className = 'caro-thumb' + (active ? ' active' : '');
    cell.title = page.name || `Page ${i + 1}`;
    const disk = document.createElement('div');
    disk.className = 'caro-disk';
    const mini = buildPageStatic(page, model.state.components || {});
    disk.appendChild(mini);                       // attaché : buildPageStatic a déjà mesuré/positionné
    mini.style.transformOrigin = 'top left';
    mini.style.transform = `scale(${THUMB / 360})`;
    cell.appendChild(disk);
    if (renaming === i) {
      const inp = document.createElement('input'); inp.className = 'caro-rename'; inp.value = page.name || '';
      const commit = () => {
        const v = inp.value.trim(); renaming = null;
        if (v && v !== page.name && !pageNameTaken(model.state, v, i)) model.commit(s => renamePage(s, i, v));
        else render();
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') inp.blur();
        if (e.key === 'Escape') { renaming = null; render(); }
      });
      cell.appendChild(inp); queueMicrotask(() => inp.focus());
    } else {
      const cap = document.createElement('div'); cap.className = 'caro-cap';
      cap.textContent = page.name || `Page ${i + 1}`;
      cell.appendChild(cap);
    }
    cell.addEventListener('click', () => {
      setPage(i);                                 // active la page (re-render canvas) + vide la sélection
      setSelection({ kind: 'page', page: i });    // puis sélectionne la page (cohérent avec l'arbre)
    });
    cell.addEventListener('contextmenu', e => {
      e.preventDefault();
      setPage(i); setSelection({ kind: 'page', page: i });
      openContextMenu(e.clientX, e.clientY,
        contextMenuItems({ kind: 'page', page: i }, model.state, {}),
        (id) => runMenu(id, i));
    });
    cell.draggable = true;
    cell.addEventListener('dragstart', e => {
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `page:${i}`);   // parité tree.js : drop autorisé cross-navigateur
    });
    cell.addEventListener('dragend', () => { dragFrom = null; clearDropMarks(); });
    cell.addEventListener('dragover', e => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      clearDropMarks();
      cell.classList.add('caro-drop');
    });
    cell.addEventListener('drop', e => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      const from = dragFrom, to = i;
      model.commit(s => reorderPages(s, from, to));
      setPage(to); setSelection({ kind: 'page', page: to });
      dragFrom = null;
    });
    return cell;
  }

  // Renommage inline : passe en mode édition pour la vignette d'index pi.
  function beginRename(pi) { renaming = pi; render(); }

  // Exécute une action du menu contextuel sur la page d'index pi.
  function runMenu(id, pi) {
    const total = () => model.state.pages.length;
    if (id === 'rename')    return beginRename(pi);
    if (id === 'duplicate') { let ni = -1; model.commit(s => { ni = duplicatePage(s, pi); });
      if (ni >= 0) { setPage(ni); setSelection({ kind: 'page', page: ni }); } return; }
    if (id === 'delete')    { if (total() <= 1) return; model.commit(s => removePage(s, pi));
      setPage(Math.min(pi, model.state.pages.length - 1)); return; }
    if (id === 'moveUp')    { if (pi <= 0) return; model.commit(s => reorderPages(s, pi, pi - 1));
      setPage(pi - 1); setSelection({ kind: 'page', page: pi - 1 }); return; }
    if (id === 'moveDown')  { if (pi >= total() - 1) return; model.commit(s => reorderPages(s, pi, pi + 1));
      setPage(pi + 1); setSelection({ kind: 'page', page: pi + 1 }); return; }
  }

  function render() {
    host.replaceChildren();
    const pages = model.state.pages || [];
    const act = getActivePage();
    const left  = document.createElement('button'); left.className  = 'caro-arrow'; left.textContent  = '◀';
    const right = document.createElement('button'); right.className = 'caro-arrow'; right.textContent = '▶';
    const track = document.createElement('div');
    track.className = 'caro-track';
    pages.forEach((p, i) => track.appendChild(thumb(p, i, i === act)));
    const add = document.createElement('button');
    add.className = 'caro-add';
    add.textContent = '+';
    add.title = 'Ajouter une page';
    add.disabled = !canAddPage(model.state);
    add.addEventListener('click', () => {
      const name = uniquePageName(model.state);
      let ni = -1;
      model.commit(s => { addPage(s, name); ni = s.pages.length - 1; });
      setPage(ni); setSelection({ kind: 'page', page: ni });
    });
    track.appendChild(add);
    const syncArrows = () => {
      const s = arrowState({ scrollLeft: track.scrollLeft, scrollWidth: track.scrollWidth, clientWidth: track.clientWidth });
      left.disabled  = !s.left;
      right.disabled = !s.right;
    };
    left.addEventListener('click',  () => { track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' }); });
    right.addEventListener('click', () => { track.scrollBy({ left:  track.clientWidth * 0.8, behavior: 'smooth' }); });
    track.addEventListener('scroll', syncArrows);
    host.append(left, track, right);
    syncArrows();   // état initial (après insertion : tailles connues)
  }

  model.subscribe(render);        // mutations : structure des pages + édition des composants (miniatures)
  selection.subscribe(render);    // changement de page active / sélection → surlignage
  render();
  if (document.fonts?.ready) document.fonts.ready.then(render);   // fidélité Montserrat (cf. canvas.js)
  return { render };
}

// Arbre des calques du designer. Deux faces : treeModel (pur, testé node) calcule la structure
// affichée ; createTree (plus bas, Task 2+) en fait du DOM et pilote la sélection partagée.
// Remplace nav#pages : Document → pages (ordre nav) → composants (z-order INVERSÉ). cf. spec §1.
import { COMPONENTS } from './registry.js';
import { iconFor } from './icons.js';
import { setComponentProp, addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken, renameComponent, duplicatePage, reorderPlacement, movePlacementToPage, isValidId } from './mutations.js';
import { logs } from './logs.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { contextMenuItems, openContextMenu, closeContextMenu } from './contextmenu.js';
import { withConfirm } from './confirm.js';

// Œil de visibilité — mêmes icônes que l'en-tête inspecteur (brique commune, cf. spec §1).
const EYE_OPEN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23E5E7EB' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E";
const EYE_OFF_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cline x1='3' y1='3' x2='21' y2='21'/%3E%3C/svg%3E";

// Structure pure pour le rendu. Les composants sont renvoyés en ordre inversé (dernier placement =
// dessus = première ligne) MAIS chaque item garde son index RÉEL dans place[] (cible de la sélection
// et des mutations). visible=false seulement si la clé vaut explicitement false (cohérent firmware/
// canvas/inspecteur). Le libellé vient du registre ; repli '?' si le ref est orphelin.
export function treeModel(state) {
  const comps = state?.components || {};
  const pages = (state?.pages || []).map((p, index) => {
    const place = Array.isArray(p.place) ? p.place : [];
    const components = place
      .map((pl, i) => {
        const c = comps[pl.ref];
        const type = c?.type ?? null;
        return {
          index: i,                                   // position réelle dans place[]
          ref: pl.ref,
          type,
          label: type ? t(COMPONENTS[type].label) : '?',
          visible: c?.visible !== false,
        };
      })
      .reverse();                                     // z-order inversé : dessus en premier
    return { index, name: p.name, components };
  });
  return { title: state?.title ?? '', pages };
}

// Drop d'un composant (drag&drop arbre) → index cible dans place[]. L'arbre affiche place[] INVERSÉ
// (dessus = fin de place[]). `before` = curseur dans la moitié HAUTE de la ligne cible. Pur (testé node) :
// c'est le calcul délicat (inversion + compensation du splice), donc isolé du DOM.
export function reorderTargetIndex(place, fromReal, toReal, before) {
  const n = place.length;
  const dFrom = n - 1 - fromReal;                 // index display de la source
  let dTo = n - 1 - toReal + (before ? 0 : 1);    // insertion avant/après la cible en display
  if (dTo > dFrom) dTo -= 1;                       // compense le retrait de la source avant réinsertion
  const realTo = n - 1 - dTo;                      // retour en coordonnées place[]
  return Math.max(0, Math.min(n - 1, realTo));
}

// Drop d'un composant venu d'UNE AUTRE PAGE → index d'INSERTION dans place[] de la page cible. Comme
// reorderTargetIndex l'affichage est inversé (dessus = fin de place[]) et `before` = moitié HAUTE de la
// ligne cible — mais SANS la compensation de splice (la source n'est pas retirée de cette page, donc place
// gagne un élément). L'index peut valoir n (insertion en fin = au sommet du z-order). Pur (testé node).
export function insertTargetIndex(place, toReal, before) {
  const n = place.length;
  return Math.max(0, Math.min(n, toReal + (before ? 1 : 0)));
}

// Rendu DOM de l'arbre + pilotage de la sélection partagée. Deps : getActivePage/setPage (la page
// active vit dans canvas.js) PLUS le store de sélection (selection/setSelection). Pilote pages + comps.
export function createTree(root, model, { selection, setSelection, getActivePage = () => 0, setPage, compActions = {}, getClipboard = () => null } = {}) {
  let renaming = null;   // index de la page en cours de renommage inline, ou null
  let renamingComp = null;   // { page, index } du composant en rename inline, ou null
  let dragSrc = null;   // { page, index } du composant en cours de drag
  let dragSrcPage = null;   // index de la page en cours de drag (réordonnancement), ou null
  const expanded = new Set([getActivePage()]);   // pages dépliées (page active auto-dépliée)
  // setPage du host (canvas) + auto-dépliage de la page qui devient active.
  const goPage = (i) => { expanded.add(i); setPage(i); };
  const clearDropMarks = () => root.querySelectorAll('.drop-before,.drop-after,.drop-into')
    .forEach(n => n.classList.remove('drop-before', 'drop-after', 'drop-into'));

  // Backstop : après removePage/undo/import l'index actif peut dépasser la liste → on le ramène.
  function clampActive() {
    const n = model.state.pages?.length ?? 0;
    if (n && getActivePage() > n - 1) setPage(n - 1);
    for (const i of [...expanded]) if (i >= n) expanded.delete(i);
  }

  function compRow(c, pageIndex, sel) {
    if (renamingComp && renamingComp.page === pageIndex && renamingComp.index === c.index) {
      const row = document.createElement('div'); row.className = 'tree-row tree-comp';
      const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = c.ref;
      const orig = c.ref;
      const tryCommit = () => {
        const id = inp.value.trim();
        if (!id || id === orig) { renamingComp = null; render(); return true; }   // vide/identique → annule
        if (!isValidId(id)) { showToast(t('id.invalid')); return false; }
        if (model.state.components?.[id]) { showToast(t('id.taken', { id })); return false; }
        renamingComp = null;
        model.commit(s => renameComponent(s, orig, id));   // → subscribe → render()
        return true;
      };
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        inp.classList.toggle('invalid', !!v && v !== orig && (!isValidId(v) || !!model.state.components?.[v]));
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); renamingComp = null; render(); }
      });
      inp.addEventListener('blur', () => { if (renamingComp && !tryCommit()) { renamingComp = null; render(); } });
      row.appendChild(inp);
      queueMicrotask(() => { inp.focus(); inp.select(); });
      return row;
    }

    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'comp' && sel.page === pageIndex && sel.index === c.index;
    row.className = 'tree-row tree-comp' + (c.visible ? '' : ' hidden') + (isSel ? ' selected' : '');
    const ic = c.type ? iconFor(c.type) : null;
    if (ic) { ic.classList.add('tree-icon'); row.appendChild(ic); }
    const lbl = document.createElement('span'); lbl.className = 'tree-label'; lbl.textContent = c.label;
    const ref = document.createElement('span'); ref.className = 'tree-ref'; ref.textContent = c.ref;
    row.appendChild(lbl); row.appendChild(ref);
    row.addEventListener('click', () => {
      if (pageIndex !== getActivePage()) goPage(pageIndex);      // bascule de page d'abord (met sel à null)…
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });  // …puis sélectionne le composant
      render();
    });
    row.addEventListener('dblclick', e => {
      e.preventDefault();
      if (pageIndex !== getActivePage()) goPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });
      renamingComp = { page: pageIndex, index: c.index };
      render();
    });
    row.draggable = true;
    // Drag HTML5 natif : NE PAS re-render dans dragstart. render() retire du DOM la ligne source du
    // drag → Chromium annule aussitôt l'opération (symptôme « impossible à saisir », alors que les
    // pages — dont le dragstart ne re-render pas — se glissent bien). On ne pose donc que dragSrc +
    // dataTransfer, comme le dragstart des pages plus bas ; la sélection définitive est posée au drop.
    row.addEventListener('dragstart', e => {
      dragSrc = { page: pageIndex, index: c.index };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.ref);
      e.stopPropagation();
    });
    row.addEventListener('dragend', () => { dragSrc = null; clearDropMarks(); render(); });
    row.addEventListener('dragover', e => {
      if (!dragSrc) return;   // intra-page (reorder) OU inter-page (insertion positionnée) : même repère
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      clearDropMarks();
      row.classList.add(before ? 'drop-before' : 'drop-after');
    });
    row.addEventListener('drop', e => {
      if (!dragSrc) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      clearDropMarks();
      const src = dragSrc;
      dragSrc = null;
      const place = model.state.pages?.[pageIndex]?.place;
      if (!place) return;   // page disparue (undo concurrent) : pas de TypeError, on nettoie
      if (src.page === pageIndex) {
        // intra-page : réordonner (z-order)
        const to = reorderTargetIndex(place, src.index, c.index, before);
        if (to !== src.index) {
          model.commit(s => reorderPlacement(s, pageIndex, src.index, to));
          setSelection({ kind: 'comp', page: pageIndex, index: to });   // la sélection suit
        }
      } else {
        // inter-page : insérer à la position visée (≠ toujours en fin) dans CETTE page, comme l'intra-page
        const to = insertTargetIndex(place, c.index, before);
        model.commit(s => movePlacementToPage(s, src.page, src.index, pageIndex, to));
        goPage(pageIndex);
        setSelection({ kind: 'comp', page: pageIndex, index: to });   // suit le composant migré
      }
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (pageIndex !== getActivePage()) goPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });
      render();
      openContextMenu(e.clientX, e.clientY,
        contextMenuItems(selection.get(), model.state, { hasClipboard: !!getClipboard() }),
        runMenu);
    });
    // Œil de visibilité (brique commune avec l'en-tête inspecteur) : toggle de la clé `visible`.
    const spacer = document.createElement('span'); spacer.className = 'tree-spacer';
    row.appendChild(spacer);
    const eye = document.createElement('button');
    eye.className = 'insp-eye';                       // style partagé (icône bouton plat)
    eye.title = c.visible ? t('tree.eye.visible') : t('tree.eye.hidden');
    const icon = document.createElement('img');
    icon.src = c.visible ? EYE_OPEN_URI : EYE_OFF_URI;
    icon.width = 14; icon.height = 14; icon.alt = c.visible ? t('tree.eye.alt_visible') : t('tree.eye.alt_hidden');
    eye.appendChild(icon);
    const cref = c.ref, cvis = c.visible;            // figés au rendu (closure)
    eye.addEventListener('click', e => {
      e.stopPropagation();                            // ne pas sélectionner la ligne
      model.commit(s => setComponentProp(s, cref, 'visible', cvis ? false : true));
    });
    row.appendChild(eye);
    return row;
  }

  function pageRow(p, sel) {
    // Mode renommage inline (garde anti-doublon : le nom de page est la cible de POST /page → pas
    // de doublon).
    if (renaming === p.index) {
      const row = document.createElement('div'); row.className = 'tree-row tree-page';
      const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = p.name || '';
      const orig = p.name || '';
      const tryCommit = () => {
        const name = inp.value.trim() || uniquePageName(model.state);
        if (name === orig) { renaming = null; render(); return true; }      // pas de changement
        if (!isValidId(name)) { showToast(t('page.invalid_name')); return false; }
        if (pageNameTaken(model.state, name, p.index)) { showToast(t('page.name_taken', { name })); return false; }
        renaming = null;
        model.commit(s => renamePage(s, p.index, name));                    // → subscribe → render()
        logs.logActivity(t('activity.page_renamed', { name }));
        return true;
      };
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        inp.classList.toggle('invalid', !!v && (!isValidId(v) || pageNameTaken(model.state, v, p.index)));   // feedback live
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }         // doublon → toast + reste en édition
        else if (e.key === 'Escape') { e.preventDefault(); renaming = null; render(); }
      });
      // Clic ailleurs : valide si possible, sinon annule (revert — jamais de doublon).
      inp.addEventListener('blur', () => { if (renaming === p.index && !tryCommit()) { renaming = null; render(); } });
      row.appendChild(inp);
      queueMicrotask(() => inp.focus());
      return row;
    }

    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'page' && sel.page === p.index;
    row.className = 'tree-row tree-page' + (isSel ? ' selected' : '');
    const tw = document.createElement('span'); tw.className = 'tree-twist';
    const isOpen = expanded.has(p.index);
    tw.textContent = isOpen ? '▾' : '▸';
    tw.title = isOpen ? t('tree.twist.collapse') : t('tree.twist.expand');
    tw.addEventListener('click', e => {
      e.stopPropagation();
      if (expanded.has(p.index)) expanded.delete(p.index); else expanded.add(p.index);
      render();
    });
    const lbl = document.createElement('span'); lbl.className = 'tree-label';
    lbl.textContent = p.name || t('page.default', { n: p.index + 1 });
    row.appendChild(tw); row.appendChild(lbl);
    row.addEventListener('click', () => {
      goPage(p.index);                                   // met la sélection à null (canvas)…
      setSelection({ kind: 'page', page: p.index });     // …puis sélectionne la page
      render();
    });
    row.draggable = true;
    row.addEventListener('dragstart', e => {
      dragSrcPage = p.index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `page:${p.index}`);
      e.stopPropagation();
    });
    row.addEventListener('dragend', () => { dragSrcPage = null; clearDropMarks(); render(); });
    row.addEventListener('dragover', e => {
      if (!dragSrc || dragSrc.page === p.index) return;   // move seulement vers une AUTRE page
      e.preventDefault();
      clearDropMarks();
      row.classList.add('drop-into');
    });
    row.addEventListener('drop', e => {
      if (!dragSrc || dragSrc.page === p.index) return;
      e.preventDefault();
      clearDropMarks();
      const fromPage = dragSrc.page, placeIndex = dragSrc.index, toPage = p.index;
      model.commit(s => movePlacementToPage(s, fromPage, placeIndex, toPage));
      const last = (model.state.pages?.[toPage]?.place?.length || 1) - 1;
      goPage(toPage);
      setSelection({ kind: 'comp', page: toPage, index: last });
      dragSrc = null;
    });
    row.addEventListener('dragover', e => {
      if (dragSrcPage != null && dragSrcPage !== p.index) {   // réordonner des pages
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        clearDropMarks();
        row.classList.add(before ? 'drop-before' : 'drop-after');
      }
    });
    row.addEventListener('drop', e => {
      if (dragSrcPage == null || dragSrcPage === p.index) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      let to = p.index + (before ? 0 : 1);
      if (to > dragSrcPage) to -= 1;                           // compense le retrait de la source
      const from = dragSrcPage;
      clearDropMarks();
      if (to !== from) {
        model.commit(s => reorderPages(s, from, to));
        goPage(to);
        setSelection({ kind: 'page', page: to });
      }
      dragSrcPage = null;
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      goPage(p.index);
      setSelection({ kind: 'page', page: p.index });
      render();
      openContextMenu(e.clientX, e.clientY,
        contextMenuItems(selection.get(), model.state, { hasClipboard: !!getClipboard() }),
        runMenu);
    });

    // Contrôles au survol : renommer / monter / descendre / supprimer (réutilisent les mutations pages).
    const spacer = document.createElement('span'); spacer.className = 'tree-spacer'; row.appendChild(spacer);
    const actions = document.createElement('div'); actions.className = 'tree-actions';
    const total = model.state.pages?.length ?? 0;
    const mkAct = (txt, title, fn, disabled) => {
      const b = document.createElement('button'); b.textContent = txt; b.title = title; b.disabled = !!disabled;
      b.addEventListener('click', e => { e.stopPropagation(); if (!disabled) fn(); });   // ne pas (re)sélectionner la ligne
      actions.appendChild(b);
    };
    mkAct('✎', t('tree.act.rename'), () => { goPage(p.index); renaming = p.index; render(); });
    mkAct('⧉', t('tree.act.duplicate'), () => {
      let ni = -1;
      model.commit(s => { ni = duplicatePage(s, p.index); });
      if (ni >= 0) { goPage(ni); setSelection({ kind: 'page', page: ni }); }
      logs.logActivity(t('activity.page_duplicated'));
      render();
    });
    mkAct('↑', t('tree.act.move_up'), () => {
      model.commit(s => reorderPages(s, p.index, p.index - 1)); goPage(p.index - 1); render();
    }, p.index <= 0);
    mkAct('↓', t('tree.act.move_down'), () => {
      model.commit(s => reorderPages(s, p.index, p.index + 1)); goPage(p.index + 1); render();
    }, p.index >= total - 1);
    // ✕ Supprimer : page vide → suppression directe ; page AVEC composants → garde-fou double-clic (confirm.js).
    const del = document.createElement('button');
    del.textContent = '✕'; del.title = t('tree.act.delete'); del.disabled = total <= 1;
    const doDelete = () => {
      model.commit(s => removePage(s, p.index));
      goPage(Math.min(p.index, model.state.pages.length - 1));
      logs.logActivity(t('activity.page_deleted'));
      render();
    };
    del.addEventListener('click', e => e.stopPropagation());   // ne pas (re)sélectionner la ligne
    if (p.components.length) withConfirm(del, doDelete);        // page non vide → confirmer
    else del.addEventListener('click', doDelete);
    actions.appendChild(del);
    row.appendChild(actions);
    return row;
  }

  // Ligne placeholder d'une page vide DÉPLIÉE : grande cible de dépôt explicite (l'en-tête seul est trop
  // petit à viser en drag, et on s'attend à lâcher « dans » la page). Reçoit un composant venu d'une AUTRE
  // page → movePlacementToPage sans toIndex (= en fin = index 0 sur une page vide). Non draggable.
  function emptyDropRow(pageIndex) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-comp tree-empty';
    const lbl = document.createElement('span'); lbl.className = 'tree-label';
    lbl.textContent = t('tree.empty_drop');
    row.appendChild(lbl);
    row.addEventListener('dragover', e => {
      if (!dragSrc || dragSrc.page === pageIndex) return;   // un composant venu d'une AUTRE page
      e.preventDefault();
      clearDropMarks();
      row.classList.add('drop-into');
    });
    row.addEventListener('drop', e => {
      if (!dragSrc || dragSrc.page === pageIndex) return;
      e.preventDefault();
      clearDropMarks();
      const src = dragSrc;
      dragSrc = null;
      model.commit(s => movePlacementToPage(s, src.page, src.index, pageIndex));
      goPage(pageIndex);
      setSelection({ kind: 'comp', page: pageIndex, index: 0 });
    });
    return row;
  }

  function render() {
    clampActive();
    root.querySelectorAll('.tree, .tree-head').forEach(n => n.remove());
    const tm = treeModel(model.state);
    const sel = selection.get();

    // En-tête : ajout de page (hors .tree pour survivre à son nettoyage à chaque render).
    const head = document.createElement('div'); head.className = 'tree-head';
    const addBtn = document.createElement('button'); addBtn.className = 'tree-addbtn'; addBtn.textContent = t('tree.add_page');
    addBtn.addEventListener('click', () => {
      model.commit(s => addPage(s, uniquePageName(s)));   // nom auto sans collision
      const last = model.state.pages.length - 1;
      goPage(last);
      setSelection({ kind: 'page', page: last });
      logs.logActivity(t('activity.page_added'));
      render();
    });
    head.appendChild(addBtn);
    root.appendChild(head);

    const tree = document.createElement('div'); tree.className = 'tree';

    // Document
    const doc = document.createElement('div');
    doc.className = 'tree-row tree-doc' + (sel && sel.kind === 'doc' ? ' selected' : '');
    const dtw = document.createElement('span'); dtw.className = 'tree-twist'; dtw.textContent = '⚙';
    const dlbl = document.createElement('span'); dlbl.className = 'tree-label';
    dlbl.textContent = t('tree.doc', { title: tm.title || t('tree.untitled') });
    doc.appendChild(dtw); doc.appendChild(dlbl);
    doc.addEventListener('click', () => { setSelection({ kind: 'doc' }); render(); });
    tree.appendChild(doc);

    // Pages (+ composants des pages dépliées)
    tm.pages.forEach(p => {
      tree.appendChild(pageRow(p, sel));
      if (expanded.has(p.index)) {
        if (p.components.length) p.components.forEach(c => tree.appendChild(compRow(c, p.index, sel)));
        else tree.appendChild(emptyDropRow(p.index));   // page vide dépliée : cible de dépôt explicite
      }
    });

    root.appendChild(tree);
  }

  model.subscribe(render);
  selection.subscribe(() => {
    const sel = selection.get();
    if (sel && sel.kind === 'comp') expanded.add(sel.page);   // sélectionner un composant (même depuis le canvas) déplie sa page
    render();
  });   // changement de sélection (canvas/inspecteur/Échap) → re-surligner
  render();

  function beginRename() {
    const sel = selection.get();
    if (!sel) return;
    if (sel.kind === 'page') { goPage(sel.page); renaming = sel.page; render(); }
    else if (sel.kind === 'comp') {
      if (sel.page !== getActivePage()) goPage(sel.page);
      renamingComp = { page: sel.page, index: sel.index };
      render();
    }
  }

  // Exécute une action du menu sur la sélection COURANTE (la ligne a été sélectionnée à l'ouverture).
  function runMenu(id, extra) {
    const sel = selection.get();
    closeContextMenu();
    if (!sel) return;
    if (sel.kind === 'comp') {
      const page = sel.page, index = sel.index;
      const place = () => model.state.pages?.[page]?.place || [];
      if (id === 'rename')    return beginRename();
      if (id === 'duplicate') return compActions.duplicate?.();
      if (id === 'copy')      return compActions.copy?.();
      if (id === 'cut')       return compActions.cut?.();
      if (id === 'paste')     return compActions.paste?.();
      if (id === 'delete')    return compActions.remove?.();
      if (id === 'raiseZ')  { const to = Math.min(index + 1, place().length - 1);
        model.commit(s => reorderPlacement(s, page, index, to)); setSelection({ kind: 'comp', page, index: to }); return; }
      if (id === 'lowerZ')  { const to = Math.max(index - 1, 0);
        model.commit(s => reorderPlacement(s, page, index, to)); setSelection({ kind: 'comp', page, index: to }); return; }
      if (id === 'moveTo')  { const toPage = extra.page;
        model.commit(s => movePlacementToPage(s, page, index, toPage));
        const last = (model.state.pages?.[toPage]?.place?.length || 1) - 1;
        goPage(toPage); setSelection({ kind: 'comp', page: toPage, index: last }); return; }
    } else if (sel.kind === 'page') {
      const pi = sel.page, total = () => model.state.pages.length;
      if (id === 'rename')    return beginRename();
      if (id === 'duplicate') { let ni = -1; model.commit(s => { ni = duplicatePage(s, pi); });
        if (ni >= 0) { goPage(ni); setSelection({ kind: 'page', page: ni }); } logs.logActivity(t('activity.page_duplicated')); return; }
      if (id === 'delete')    { if (total() <= 1) return; model.commit(s => removePage(s, pi));
        goPage(Math.min(pi, model.state.pages.length - 1)); logs.logActivity(t('activity.page_deleted')); render(); return; }
      if (id === 'moveUp')    { if (pi <= 0) return; model.commit(s => reorderPages(s, pi, pi - 1));
        goPage(pi - 1); setSelection({ kind: 'page', page: pi - 1 }); return; }
      if (id === 'moveDown')  { if (pi >= total() - 1) return; model.commit(s => reorderPages(s, pi, pi + 1));
        goPage(pi + 1); setSelection({ kind: 'page', page: pi + 1 }); return; }
    }
  }

  return { render, beginRename };
}

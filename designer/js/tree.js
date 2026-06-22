// Arbre des calques du designer. Deux faces : treeModel (pur, testé node) calcule la structure
// affichée ; createTree (plus bas, Task 2+) en fait du DOM et pilote la sélection partagée.
// Remplace nav#pages : Document → pages (ordre nav) → composants (z-order INVERSÉ). cf. spec §1.
import { COMPONENTS } from './registry.js';
import { iconFor } from './icons.js';
import { setComponentProp, addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken } from './mutations.js';
import { showToast } from './toast.js';

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
          label: (type && COMPONENTS[type]?.label) || '?',
          visible: c?.visible !== false,
        };
      })
      .reverse();                                     // z-order inversé : dessus en premier
    return { index, name: p.name, components };
  });
  return { title: state?.title ?? '', pages };
}

// Rendu DOM de l'arbre + pilotage de la sélection partagée. Mêmes deps que pages.js (getActivePage/
// setPage : la page active vit dans canvas.js) PLUS le store de sélection (selection/setSelection).
// La sélection et les interactions arrivent en Task 3 ; ici, rendu lecture seule.
export function createTree(root, model, { selection, setSelection, getActivePage = () => 0, setPage } = {}) {
  let renaming = null;   // index de la page en cours de renommage inline, ou null

  // Backstop identique à pages.js : après removePage/undo/import l'index actif peut dépasser la liste.
  function clampActive() {
    const n = model.state.pages?.length ?? 0;
    if (n && getActivePage() > n - 1) setPage(n - 1);
  }

  function compRow(c, pageIndex, sel) {
    const row = document.createElement('div');
    const isSel = sel && sel.kind === 'comp' && sel.page === pageIndex && sel.index === c.index;
    row.className = 'tree-row tree-comp' + (c.visible ? '' : ' hidden') + (isSel ? ' selected' : '');
    const ic = c.type ? iconFor(c.type) : null;
    if (ic) { ic.classList.add('tree-icon'); row.appendChild(ic); }
    const lbl = document.createElement('span'); lbl.className = 'tree-label'; lbl.textContent = c.label;
    const ref = document.createElement('span'); ref.className = 'tree-ref'; ref.textContent = c.ref;
    row.appendChild(lbl); row.appendChild(ref);
    row.addEventListener('click', () => {
      if (pageIndex !== getActivePage()) setPage(pageIndex);     // bascule de page d'abord (met sel à null)…
      setSelection({ kind: 'comp', page: pageIndex, index: c.index });  // …puis sélectionne le composant
      render();
    });
    // Œil de visibilité (brique commune avec l'en-tête inspecteur) : toggle de la clé `visible`.
    const spacer = document.createElement('span'); spacer.className = 'tree-spacer';
    row.appendChild(spacer);
    const eye = document.createElement('button');
    eye.className = 'insp-eye';                       // style partagé (icône bouton plat)
    eye.title = c.visible ? 'Visible — cliquer pour cacher' : 'Caché — cliquer pour afficher';
    const icon = document.createElement('img');
    icon.src = c.visible ? EYE_OPEN_URI : EYE_OFF_URI;
    icon.width = 14; icon.height = 14; icon.alt = c.visible ? 'visible' : 'caché';
    eye.appendChild(icon);
    const cref = c.ref, cvis = c.visible;            // figés au rendu (closure)
    eye.addEventListener('click', e => {
      e.stopPropagation();                            // ne pas sélectionner la ligne
      model.commit(s => setComponentProp(s, cref, 'visible', cvis ? false : true));
    });
    row.appendChild(eye);
    return row;
  }

  function pageRow(p, active, sel) {
    // Mode renommage inline (réutilise la garde anti-doublon de pages.js : le nom de page est la
    // cible de POST /page → pas de doublon).
    if (renaming === p.index) {
      const row = document.createElement('div'); row.className = 'tree-row tree-page';
      const inp = document.createElement('input'); inp.className = 'tree-rename'; inp.value = p.name || '';
      const orig = p.name || '';
      const tryCommit = () => {
        const name = inp.value.trim() || uniquePageName(model.state);
        if (name === orig) { renaming = null; render(); return true; }      // pas de changement
        if (pageNameTaken(model.state, name, p.index)) { showToast(`« ${name} » est déjà utilisé`); return false; }
        renaming = null;
        model.commit(s => renamePage(s, p.index, name));                    // → subscribe → render()
        return true;
      };
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        inp.classList.toggle('invalid', !!v && pageNameTaken(model.state, v, p.index));   // feedback live
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
    const tw = document.createElement('span'); tw.className = 'tree-twist'; tw.textContent = active ? '▾' : '▸';
    const lbl = document.createElement('span'); lbl.className = 'tree-label';
    lbl.textContent = p.name || `Page ${p.index + 1}`;
    row.appendChild(tw); row.appendChild(lbl);
    row.addEventListener('click', () => {
      setPage(p.index);                                  // met la sélection à null (canvas)…
      setSelection({ kind: 'page', page: p.index });     // …puis sélectionne la page
      render();
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
    mkAct('✎', 'Renommer', () => { setPage(p.index); renaming = p.index; render(); });
    mkAct('↑', 'Monter', () => {
      model.commit(s => reorderPages(s, p.index, p.index - 1)); setPage(p.index - 1); render();
    }, p.index <= 0);
    mkAct('↓', 'Descendre', () => {
      model.commit(s => reorderPages(s, p.index, p.index + 1)); setPage(p.index + 1); render();
    }, p.index >= total - 1);
    mkAct('✕', 'Supprimer la page', () => {
      model.commit(s => removePage(s, p.index));
      setPage(Math.min(p.index, model.state.pages.length - 1));
      render();
    }, total <= 1);
    row.appendChild(actions);
    return row;
  }

  function render() {
    clampActive();
    root.querySelectorAll('.tree, .tree-head').forEach(n => n.remove());
    const t = treeModel(model.state);
    const active = getActivePage();
    const sel = selection.get();

    // En-tête : ajout de page (hors .tree pour survivre à son nettoyage à chaque render).
    const head = document.createElement('div'); head.className = 'tree-head';
    const addBtn = document.createElement('button'); addBtn.className = 'tree-addbtn'; addBtn.textContent = '+ Page';
    addBtn.addEventListener('click', () => {
      model.commit(s => addPage(s, uniquePageName(s)));   // nom auto sans collision
      const last = model.state.pages.length - 1;
      setPage(last);
      setSelection({ kind: 'page', page: last });
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
    dlbl.textContent = `Document — ${t.title || '(sans titre)'}`;
    doc.appendChild(dtw); doc.appendChild(dlbl);
    doc.addEventListener('click', () => { setSelection({ kind: 'doc' }); render(); });
    tree.appendChild(doc);

    // Pages (+ composants de la page active uniquement, MVP)
    t.pages.forEach(p => {
      tree.appendChild(pageRow(p, p.index === active, sel));
      if (p.index === active) p.components.forEach(c => tree.appendChild(compRow(c, p.index, sel)));
    });

    root.appendChild(tree);
  }

  model.subscribe(render);
  selection.subscribe(render);   // changement de sélection (canvas/inspecteur/Échap) → re-surligner
  render();
  return { render };
}

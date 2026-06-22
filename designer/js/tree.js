// Arbre des calques du designer. Deux faces : treeModel (pur, testé node) calcule la structure
// affichée ; createTree (plus bas, Task 2+) en fait du DOM et pilote la sélection partagée.
// Remplace nav#pages : Document → pages (ordre nav) → composants (z-order INVERSÉ). cf. spec §1.
import { COMPONENTS } from './registry.js';
import { iconFor } from './icons.js';

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
  // Backstop identique à pages.js : après removePage/undo/import l'index actif peut dépasser la liste.
  function clampActive() {
    const n = model.state.pages?.length ?? 0;
    if (n && getActivePage() > n - 1) setPage(n - 1);
  }

  function compRow(c) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-comp' + (c.visible ? '' : ' hidden');
    const ic = c.type ? iconFor(c.type) : null;
    if (ic) { ic.classList.add('tree-icon'); row.appendChild(ic); }
    const lbl = document.createElement('span'); lbl.className = 'tree-label'; lbl.textContent = c.label;
    const ref = document.createElement('span'); ref.className = 'tree-ref'; ref.textContent = c.ref;
    row.appendChild(lbl); row.appendChild(ref);
    return row;
  }

  function pageRow(p, active) {
    const row = document.createElement('div');
    row.className = 'tree-row tree-page';
    const tw = document.createElement('span'); tw.className = 'tree-twist'; tw.textContent = active ? '▾' : '▸';
    const lbl = document.createElement('span'); lbl.className = 'tree-label';
    lbl.textContent = p.name || `Page ${p.index + 1}`;
    row.appendChild(tw); row.appendChild(lbl);
    return row;
  }

  function render() {
    clampActive();
    root.querySelectorAll('.tree').forEach(n => n.remove());
    const t = treeModel(model.state);
    const active = getActivePage();
    const tree = document.createElement('div'); tree.className = 'tree';

    // Document
    const doc = document.createElement('div'); doc.className = 'tree-row tree-doc';
    const dtw = document.createElement('span'); dtw.className = 'tree-twist'; dtw.textContent = '⚙';
    const dlbl = document.createElement('span'); dlbl.className = 'tree-label';
    dlbl.textContent = `Document — ${t.title || '(sans titre)'}`;
    doc.appendChild(dtw); doc.appendChild(dlbl);
    tree.appendChild(doc);

    // Pages (+ composants de la page active uniquement, MVP)
    t.pages.forEach(p => {
      tree.appendChild(pageRow(p, p.index === active));
      if (p.index === active) p.components.forEach(c => tree.appendChild(compRow(c)));
    });

    root.appendChild(tree);
  }

  model.subscribe(render);
  render();
  return { render };
}

// Onglets de pages. Un onglet par page (clic = page active ; double-clic = éditer le nom). Les
// contrôles agissent sur la page ACTIVE : + Page (ajoute en fin et l'active), Renommer (édition inline
// du nom — aussi par double-clic sur l'onglet —, pas de prompt()),
// ◀/▶ (réordonne la page active), Supprimer (désactivé s'il ne reste qu'une page). La page active
// vit dans le canvas (source de vérité unique), lue via getActivePage et pilotée via setPage.
import { addPage, removePage, renamePage, reorderPages, uniquePageName, pageNameTaken } from './mutations.js';
import { showToast } from './toast.js';

function mkBtn(text, onClick, cls) {
  const b = document.createElement('button');
  b.className = 'page-btn' + (cls ? ' ' + cls : '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

export function createPages(root, model, { getActivePage, setPage } = {}) {
  let renaming = null; // index de la page en cours de renommage inline, ou null
  let dragFrom = null; // index de l'onglet en cours de glisser (réordonnancement), ou null

  // Backstop : après removePage (ou undo/import), l'index actif peut dépasser la liste → on le ramène.
  function clampActive() {
    const n = model.state.pages?.length ?? 0;
    if (n && getActivePage() > n - 1) setPage(n - 1);
  }

  function render() {
    clampActive();
    root.replaceChildren();
    const pages = Array.isArray(model.state.pages) ? model.state.pages : [];  // import au pages non-array : pas de throw → json-view signale la forme
    const active = getActivePage();

    const tabs = document.createElement('div');
    tabs.className = 'page-tabs';
    pages.forEach((p, i) => {
      if (renaming === i) {
        const inp = document.createElement('input');
        inp.className = 'page-rename';
        inp.value = p.name || '';
        const orig = p.name || '';
        // Valide la saisie : vide → « Page N » unique ; doublon → bloqué (toast, on reste en édition) ;
        // sinon commit. Renvoie false si bloqué. Le nom de page est la cible de POST /page → pas de doublon.
        const tryCommit = () => {
          const name = inp.value.trim() || uniquePageName(model.state);
          if (name === orig) { renaming = null; render(); return true; }      // pas de changement
          if (pageNameTaken(model.state, name, i)) { showToast(`« ${name} » est déjà utilisé`); return false; }
          renaming = null;
          model.commit(s => renamePage(s, i, name));                          // → subscribe → render()
          return true;
        };
        inp.addEventListener('input', () => {
          const v = inp.value.trim();
          inp.classList.toggle('invalid', !!v && pageNameTaken(model.state, v, i));   // feedback live
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { e.preventDefault(); tryCommit(); }        // doublon → toast + reste en édition
          else if (e.key === 'Escape') { e.preventDefault(); renaming = null; render(); }
        });
        // Clic ailleurs : valide si possible, sinon annule (revert à l'ancien nom — jamais de doublon).
        inp.addEventListener('blur', () => { if (renaming === i && !tryCommit()) { renaming = null; render(); } });
        tabs.appendChild(inp);
        queueMicrotask(() => inp.focus());
      } else {
        const tab = document.createElement('button');
        tab.className = 'page-tab' + (i === active ? ' active' : '');
        tab.textContent = p.name || `Page ${i + 1}`;
        tab.title = 'Glisser pour réordonner';
        tab.draggable = true;
        tab.addEventListener('click', () => { setPage(i); render(); });
        // Double-clic sur l'onglet → édition inline directe du nom (raccourci du bouton « Renommer »).
        tab.addEventListener('dblclick', () => { setPage(i); renaming = i; render(); });
        // --- Réordonnancement par glisser-déposer (alternative directe aux boutons ◀ ▶) ---
        // type 'text/rt-page' distinct des drags de la palette ('rt-type') → pas d'interférence.
        tab.addEventListener('dragstart', e => {
          dragFrom = i;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/rt-page', String(i));
          tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', () => {
          dragFrom = null; tab.classList.remove('dragging');
          tabs.querySelectorAll('.drag-over').forEach(t => t.classList.remove('drag-over'));
        });
        tab.addEventListener('dragover', e => {
          if (dragFrom == null || dragFrom === i) return;   // pas de drop sur soi ; ignore les drags d'ailleurs
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          tab.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
        tab.addEventListener('drop', e => {
          e.preventDefault();
          tab.classList.remove('drag-over');
          const from = dragFrom;
          dragFrom = null;
          if (from == null || from === i) return;
          model.commit(s => reorderPages(s, from, i));      // l'onglet déposé prend l'index i…
          setPage(i);                                        // …et devient la page active
          render();
        });
        tabs.appendChild(tab);
      }
    });
    root.appendChild(tabs);

    const ctrls = document.createElement('div');
    ctrls.className = 'page-ctrls';

    ctrls.appendChild(mkBtn('+ Page', () => {
      model.commit(s => addPage(s, uniquePageName(s)));   // nom auto sans collision (cf. uniquePageName)
      setPage(model.state.pages.length - 1);
      render();
    }));

    ctrls.appendChild(mkBtn('Renommer', () => { renaming = active; render(); }));

    const left = mkBtn('◀', () => {
      if (active <= 0) return;
      model.commit(s => reorderPages(s, active, active - 1));
      setPage(active - 1);
      render();
    });
    left.disabled = active <= 0;
    ctrls.appendChild(left);

    const right = mkBtn('▶', () => {
      if (active >= pages.length - 1) return;
      model.commit(s => reorderPages(s, active, active + 1));
      setPage(active + 1);
      render();
    });
    right.disabled = active >= pages.length - 1;
    ctrls.appendChild(right);

    const del = mkBtn('Supprimer', () => {
      if (pages.length <= 1) return;                       // garder au moins une page
      model.commit(s => removePage(s, active));
      setPage(Math.min(active, model.state.pages.length - 1));
      render();
    }, 'page-del');
    del.disabled = pages.length <= 1;
    ctrls.appendChild(del);

    root.appendChild(ctrls);
  }

  model.subscribe(render);
  render();
  return { render };
}

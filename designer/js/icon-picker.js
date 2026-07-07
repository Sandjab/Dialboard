// Overlay de sélection d'icône MDI : recherche (nom/tag) + filtre catégorie + grille cliquable.
// DOM créé à la demande (transitoire), vérifié au navigateur. La logique de filtre est PURE et testée
// (icon-filter.js). Un seul picker ouvert à la fois. onPick(name) — name=null si « base » (allowClear).
import { ICONS } from '../vendor/icons/icons-data.js';
import { filterIcons, categoriesOf } from './icon-filter.js';
import { t } from './i18n.js';

let _open = null;   // { overlay, onKey } du picker courant

export function closeIconPicker() {
  if (!_open) return;
  document.removeEventListener('keydown', _open.onKey);
  _open.overlay.remove();
  _open = null;
}

export function openIconPicker({ current = null, onPick, allowClear = false } = {}) {
  closeIconPicker();

  const overlay = document.createElement('div');
  overlay.className = 'shot-overlay iconpick-overlay';
  const box = document.createElement('div');
  box.className = 'iconpick-box';
  overlay.appendChild(box);

  const bar = document.createElement('div');
  bar.className = 'iconpick-bar';
  const search = document.createElement('input');
  search.type = 'search'; search.className = 'iconpick-search';
  search.placeholder = t('iconpicker.search');
  const catSel = document.createElement('select');
  catSel.className = 'iconpick-cat';
  const optAll = document.createElement('option');
  optAll.value = ''; optAll.textContent = t('iconpicker.all_cats');
  catSel.appendChild(optAll);
  for (const cat of categoriesOf(ICONS)) {
    const o = document.createElement('option'); o.value = cat; o.textContent = cat; catSel.appendChild(o);
  }
  const closeBtn = document.createElement('button');
  closeBtn.className = 'iconpick-close'; closeBtn.type = 'button'; closeBtn.textContent = '×';
  bar.append(search, catSel, closeBtn);
  box.appendChild(bar);

  const grid = document.createElement('div');
  grid.className = 'iconpick-grid';
  box.appendChild(grid);

  const pick = name => { closeIconPicker(); onPick?.(name); };

  const renderGrid = () => {
    grid.textContent = '';
    if (allowClear) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'iconpick-item iconpick-base';
      if (current == null) b.classList.add('sel');
      b.textContent = t('inspector.opt.base');
      b.addEventListener('click', () => pick(null));
      grid.appendChild(b);
    }
    const matches = filterIcons(ICONS, search.value, catSel.value || null);
    for (const ic of matches) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'iconpick-item' + (ic.name === current ? ' sel' : '');
      b.title = ic.name;
      const g = document.createElement('i'); g.className = 'mdi'; g.textContent = ic.ch;
      const lbl = document.createElement('span'); lbl.className = 'iconpick-name'; lbl.textContent = ic.name;
      b.append(g, lbl);
      b.addEventListener('click', () => pick(ic.name));
      grid.appendChild(b);
    }
    if (!matches.length) {
      const e = document.createElement('div'); e.className = 'iconpick-empty'; e.textContent = t('iconpicker.none');
      grid.appendChild(e);
    }
  };

  search.addEventListener('input', renderGrid);
  catSel.addEventListener('change', renderGrid);
  closeBtn.addEventListener('click', () => closeIconPicker());
  overlay.addEventListener('pointerdown', e => {
    e.stopPropagation();                              // n'atteint pas la désélection globale du canvas (app.js)
    if (e.target === overlay) closeIconPicker();      // clic sur le fond ferme
  });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeIconPicker(); } };
  document.addEventListener('keydown', onKey);

  _open = { overlay, onKey };
  document.body.appendChild(overlay);
  renderGrid();
  search.focus();
}

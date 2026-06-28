// Menu contextuel partagé (arbre des calques ↔ carousel de pages).
// contextMenuItems : pur (items selon la sélection), testé node.
// openContextMenu : rendu DOM du menu flottant, onPick(id, extra) délègue l'action à l'appelant.
import { t } from './i18n.js';

// Modèle PUR du menu contextuel. Items : { id, label, disabled?, submenu? }. doc/null → [] (pas de
// menu). z-order : raiseZ = vers la FIN de place[] (dessus), lowerZ = vers le DÉBUT (fond).
// moveToPage.submenu = { id:'moveTo', label, page } des AUTRES pages (absent si une seule page).
export function contextMenuItems(sel, state, { hasClipboard = false } = {}) {
  if (!sel || sel.kind === 'doc') return [];
  const pages = state?.pages || [];
  if (sel.kind === 'page') {
    return [
      { id: 'rename', label: t('tree.act.rename') },
      { id: 'duplicate', label: t('tree.act.duplicate') },
      { id: 'delete', label: t('tree.act.delete'), disabled: pages.length <= 1 },
      { id: 'moveUp', label: t('tree.act.move_up'), disabled: sel.page <= 0 },
      { id: 'moveDown', label: t('tree.act.move_down'), disabled: sel.page >= pages.length - 1 },
    ];
  }
  // comp
  const place = pages[sel.page]?.place || [];
  const items = [
    { id: 'rename', label: t('ctx.rename_id') },
    { id: 'duplicate', label: t('ctx.duplicate') },
    { id: 'copy', label: t('ctx.copy') },
    { id: 'cut', label: t('ctx.cut') },
    { id: 'paste', label: t('ctx.paste'), disabled: !hasClipboard },
    { id: 'delete', label: t('ctx.delete') },
    { id: 'raiseZ', label: t('ctx.raise'), disabled: sel.index >= place.length - 1 },
    { id: 'lowerZ', label: t('ctx.lower'), disabled: sel.index <= 0 },
  ];
  if (pages.length > 1) {
    const submenu = pages
      .map((p, i) => ({ id: 'moveTo', label: p.name || t('page.default', { n: i + 1 }), page: i }))
      .filter(s => s.page !== sel.page);
    items.push({ id: 'moveToPage', label: t('ctx.move_to'), submenu });
  }
  return items;
}

let menuEl = null, onDocDown = null, menuKeyHandler = null;

export function closeContextMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  if (onDocDown) { document.removeEventListener('pointerdown', onDocDown, true); onDocDown = null; }
  if (menuKeyHandler) { document.removeEventListener('keydown', menuKeyHandler, true); menuKeyHandler = null; }
}

// items : sortie de contextMenuItems. onPick(id, extra) exécute l'action (câblage propre à l'appelant).
// Pour le sous-menu « Déplacer vers… », extra est l'item submenu ({ id:'moveTo', label, page }),
// d'où onPick(s.id, s) qui préserve extra.page attendu par runMenu de l'arbre.
export function openContextMenu(x, y, items, onPick) {
  closeContextMenu();
  if (!items.length) return;
  menuEl = document.createElement('div'); menuEl.className = 'tree-menu';
  menuEl.style.left = x + 'px'; menuEl.style.top = y + 'px';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'tree-menu-item' + (it.disabled ? ' disabled' : '') + (it.submenu ? ' has-sub' : '');
    row.textContent = it.label + (it.submenu ? ' ▸' : '');
    if (it.submenu) {
      const sub = document.createElement('div'); sub.className = 'tree-submenu';
      for (const s of it.submenu) {
        const sr = document.createElement('div'); sr.className = 'tree-menu-item';
        sr.textContent = s.label;
        sr.addEventListener('click', ev => { ev.stopPropagation(); closeContextMenu(); onPick(s.id, s); });
        sub.appendChild(sr);
      }
      row.appendChild(sub);
    } else if (!it.disabled) {
      row.addEventListener('click', () => { closeContextMenu(); onPick(it.id, it); });
    }
    menuEl.appendChild(row);
  }
  document.body.appendChild(menuEl);
  // Le menu vit hors de #layers : isoler son pointerdown pour que le listener global « clic ailleurs →
  // désélectionne » (app.js) ne vide pas la sélection avant que l'action (click de l'item) ne s'exécute.
  menuEl.addEventListener('pointerdown', e => e.stopPropagation());
  // Repositionner pour rester dans le viewport (un clic-droit près d'un bord déborderait).
  const mr = menuEl.getBoundingClientRect();
  if (mr.bottom > window.innerHeight) menuEl.style.top = Math.max(4, window.innerHeight - mr.height - 4) + 'px';
  if (mr.right > window.innerWidth) menuEl.style.left = Math.max(4, window.innerWidth - mr.width - 4) + 'px';
  onDocDown = e => { if (menuEl && !menuEl.contains(e.target)) closeContextMenu(); };
  document.addEventListener('pointerdown', onDocDown, true);
  menuKeyHandler = e => { if (e.key === 'Escape') closeContextMenu(); };
  document.addEventListener('keydown', menuKeyHandler, true);
}

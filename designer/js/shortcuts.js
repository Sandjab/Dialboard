// Raccourcis clavier globaux du designer — logique de décision pure (testable sans DOM).
// Le câblage de l'événement vit dans app.js. Cross-plateforme (Cmd macOS / Ctrl Windows-Linux) :
//   Cmd/Ctrl+Z        → undo
//   Cmd/Ctrl+Shift+Z  → redo
//   Cmd/Ctrl+D        → duplicate
//   Cmd/Ctrl+C        → copy
//   Cmd/Ctrl+V        → paste
//   Suppr             → delete (Delete OU Backspace : la grande touche Suppr du Mac émet Backspace)
//   Échap             → deselect (désélectionne le composant courant)
// Aucun raccourci n'agit quand le focus est dans un champ éditable : on laisse le comportement natif
// (édition de texte : champs de l'inspecteur, renommage inline de l'arbre).

// el peut être null (e.target / document.activeElement). Accepte un faux objet {tagName,isContentEditable} (tests).
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// ev : { key, metaKey, ctrlKey, shiftKey, editable }. Retourne 'undo' | 'redo' | 'duplicate' | 'copy' | 'paste' | 'delete' | 'deselect' | 'rename' | null.
export function resolveShortcut(ev) {
  if (ev.editable) return null;                          // champ texte : laisser le comportement natif
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && (ev.key || '').toLowerCase() === 'z') return ev.shiftKey ? 'redo' : 'undo';
  if (mod && !ev.shiftKey) {                             // Cmd/Ctrl + lettre (sans Shift)
    const k = (ev.key || '').toLowerCase();
    if (k === 'd') return 'duplicate';
    if (k === 'c') return 'copy';
    if (k === 'v') return 'paste';
  }
  if (!mod && (ev.key === 'Delete' || ev.key === 'Backspace')) return 'delete';
  if (!mod && ev.key === 'F2') return 'rename';
  if (!mod && ev.key === 'Escape') return 'deselect';
  return null;
}

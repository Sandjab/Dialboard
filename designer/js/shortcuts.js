// Raccourcis clavier globaux du designer — logique de décision pure (testable sans DOM).
// Le câblage de l'événement vit dans app.js. Cross-plateforme (Cmd macOS / Ctrl Windows-Linux) :
//   Cmd/Ctrl+Z        → undo
//   Cmd/Ctrl+Shift+Z  → redo
//   Suppr             → delete (Delete OU Backspace : la grande touche Suppr du Mac émet Backspace)
// Aucun raccourci n'agit quand le focus est dans un champ éditable : on laisse le comportement natif
// (édition de texte, undo natif du textarea JSON avancé).

// el peut être null (e.target / document.activeElement). Accepte un faux objet {tagName,isContentEditable} (tests).
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// ev : { key, metaKey, ctrlKey, shiftKey, editable }. Retourne 'undo' | 'redo' | 'delete' | null.
export function resolveShortcut(ev) {
  if (ev.editable) return null;                          // champ texte : laisser le comportement natif
  const mod = ev.metaKey || ev.ctrlKey;
  if (mod && (ev.key || '').toLowerCase() === 'z') return ev.shiftKey ? 'redo' : 'undo';
  if (!mod && (ev.key === 'Delete' || ev.key === 'Backspace')) return 'delete';
  return null;
}

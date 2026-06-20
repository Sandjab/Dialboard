import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShortcut, isEditableTarget } from '../js/shortcuts.js';

test('Cmd+Z (macOS) → undo', () => {
  assert.equal(resolveShortcut({ key: 'z', metaKey: true, editable: false }), 'undo');
});

test('Ctrl+Z (Windows/Linux) → undo', () => {
  assert.equal(resolveShortcut({ key: 'z', ctrlKey: true, editable: false }), 'undo');
});

test('Cmd+Shift+Z → redo (key remonte en maj sous Shift)', () => {
  assert.equal(resolveShortcut({ key: 'Z', metaKey: true, shiftKey: true, editable: false }), 'redo');
});

test('Ctrl+Shift+Z → redo', () => {
  assert.equal(resolveShortcut({ key: 'z', ctrlKey: true, shiftKey: true, editable: false }), 'redo');
});

test('Delete → delete', () => {
  assert.equal(resolveShortcut({ key: 'Delete', editable: false }), 'delete');
});

test('Backspace → delete (grande touche Suppr du Mac)', () => {
  assert.equal(resolveShortcut({ key: 'Backspace', editable: false }), 'delete');
});

test('Échap → deselect', () => {
  assert.equal(resolveShortcut({ key: 'Escape', editable: false }), 'deselect');
});

test('dans un champ éditable : Échap laisse le comportement natif (null)', () => {
  assert.equal(resolveShortcut({ key: 'Escape', editable: true }), null);
});

test('dans un champ éditable : Cmd+Z laisse l’undo natif (null)', () => {
  assert.equal(resolveShortcut({ key: 'z', metaKey: true, editable: true }), null);
});

test('dans un champ éditable : Backspace efface du texte (null)', () => {
  assert.equal(resolveShortcut({ key: 'Backspace', editable: true }), null);
});

test('z seul (sans modificateur) → null', () => {
  assert.equal(resolveShortcut({ key: 'z', editable: false }), null);
});

test('Cmd+A (autre raccourci) → null', () => {
  assert.equal(resolveShortcut({ key: 'a', metaKey: true, editable: false }), null);
});

test('Cmd+Backspace hors champ → null (réservé à l’édition de texte)', () => {
  assert.equal(resolveShortcut({ key: 'Backspace', metaKey: true, editable: false }), null);
});

test('isEditableTarget : INPUT / TEXTAREA / SELECT', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
});

test('isEditableTarget : contenteditable', () => {
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: false }), false);
});

test('isEditableTarget : bouton / null → false', () => {
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget(null), false);
});

test('Cmd+D → duplicate', () => {
  assert.equal(resolveShortcut({ key: 'd', metaKey: true, editable: false }), 'duplicate');
});
test('Ctrl+C → copy', () => {
  assert.equal(resolveShortcut({ key: 'c', ctrlKey: true, editable: false }), 'copy');
});
test('Cmd+V → paste', () => {
  assert.equal(resolveShortcut({ key: 'v', metaKey: true, editable: false }), 'paste');
});
test('Cmd+C dans un champ éditable → null (copie de texte native)', () => {
  assert.equal(resolveShortcut({ key: 'c', metaKey: true, editable: true }), null);
});
test('Cmd+Shift+D → null (non mappé, évite les raccourcis navigateur)', () => {
  assert.equal(resolveShortcut({ key: 'd', metaKey: true, shiftKey: true, editable: false }), null);
});

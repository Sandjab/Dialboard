import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBinary, PART } from '../js/ota-plan.js';

const fw = (n) => { const b = new Uint8Array(n); b[0] = 0xE9; return b; };   // magic ESP
const fs = (n) => { const b = new Uint8Array(n); b[0] = 0x00; return b; };   // pas de magic

test('validateBinary firmware : magic 0xE9 + taille ok (intent : accepter un vrai firmware)', () => {
  assert.deepEqual(validateBinary(fw(1024), 'firmware'), { ok: true, reason: null });
});

test('validateBinary firmware : sans magic → rejet (intent : refuser un fichier qui n\'est pas une image app)', () => {
  assert.equal(validateBinary(fs(1024), 'firmware').reason, 'firmware_magic');
});

test('validateBinary firmware : plus gros que le slot app → rejet (intent : ne pas deborder 0x400000)', () => {
  assert.equal(validateBinary(fw(PART.app + 1), 'firmware').reason, 'firmware_too_big');
});

test('validateBinary fs : pas de magic + taille ok (intent : accepter une image LittleFS)', () => {
  assert.deepEqual(validateBinary(fs(1024), 'fs'), { ok: true, reason: null });
});

test('validateBinary fs : commence par 0xE9 → rejet (intent : detecter un firmware mis dans le champ FS = brick)', () => {
  assert.equal(validateBinary(fw(1024), 'fs').reason, 'fs_looks_like_firmware');
});

test('validateBinary fs : plus gros que spiffs → rejet (intent : ne pas deborder 0x7E0000)', () => {
  assert.equal(validateBinary(fs(PART.spiffs + 1), 'fs').reason, 'fs_too_big');
});

test('validateBinary : octets vides/absents → empty (intent : robustesse, pas de throw)', () => {
  assert.equal(validateBinary(new Uint8Array(0), 'firmware').reason, 'empty');
  assert.equal(validateBinary(null, 'fs').reason, 'empty');
});

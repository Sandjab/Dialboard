import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBinary, PART, planFlash } from '../js/ota-plan.js';

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

const ops = (p) => p.map(s => s.op);

test('planFlash firmware+fs : backup, fs, fw, wait, restore — un seul reboot (fw auto)', () => {
  assert.deepEqual(ops(planFlash({ hasFw: true, hasFs: true, sdMounted: true })),
    ['backup', 'flashFs', 'flashFw', 'wait', 'restore']);
});

test('planFlash fs seul : reboot explicite (fs ne reboote pas)', () => {
  assert.deepEqual(ops(planFlash({ hasFw: false, hasFs: true, sdMounted: false })),
    ['backup', 'flashFs', 'reboot', 'wait', 'restore']);
});

test('planFlash firmware seul : pas de backup/restore (le FS n\'est pas touche)', () => {
  assert.deepEqual(ops(planFlash({ hasFw: true, hasFs: false, sdMounted: true })),
    ['flashFw', 'wait']);
});

test('planFlash restore.assets : true ssi pas de SD (avec SD les assets survivent)', () => {
  const withSd = planFlash({ hasFw: false, hasFs: true, sdMounted: true }).find(s => s.op === 'restore');
  const noSd = planFlash({ hasFw: false, hasFs: true, sdMounted: false }).find(s => s.op === 'restore');
  assert.equal(withSd.assets, false);
  assert.equal(noSd.assets, true);
});

test('planFlash rien : sequence vide', () => {
  assert.deepEqual(planFlash({ hasFw: false, hasFs: false, sdMounted: true }), []);
});

test('planFlash : arg non-objet (null/undefined/absent) → [] sans throw (defensif, convention projet)', () => {
  assert.deepEqual(planFlash(null), []);
  assert.deepEqual(planFlash(undefined), []);
  assert.deepEqual(planFlash(), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFSETS, validateManifest, planParts, weightedProgress } from '../js/usb-plan.js';

const goodManifest = () => ({
  version: 'v1.2.3',
  parts: [
    { path: 'bootloader.bin', offset: OFFSETS.bootloader },
    { path: 'partitions.bin', offset: OFFSETS.partitions },
    { path: 'boot_app0.bin',  offset: OFFSETS.boot_app0 },
    { path: 'firmware.bin',   offset: OFFSETS.app },
    { path: 'littlefs.bin',   offset: OFFSETS.fs },
  ],
});
const app = (n) => { const b = new Uint8Array(n || 64); b[0] = 0xE9; return b; };  // magic ESP
const raw = (n) => new Uint8Array(n || 64);

test('validateManifest : forme valide → ok (intent : accepter un manifest CI conforme)', () => {
  assert.deepEqual(validateManifest(goodManifest()), { ok: true, reason: null });
});

test('validateManifest : non-objet → shape (intent : défensif comme le reste du projet)', () => {
  assert.equal(validateManifest(null).reason, 'shape');
  assert.equal(validateManifest('x').reason, 'shape');
});

test('validateManifest : version manquante → version (intent : afficher une version fiable)', () => {
  const m = goodManifest(); delete m.version;
  assert.equal(validateManifest(m).reason, 'version');
});

test('validateManifest : offset inattendu → offset (intent : refuser un manifest qui viserait une mauvaise adresse)', () => {
  const m = goodManifest(); m.parts[0].offset = 0x1000;   // 0x1000 = bootloader ESP32 classique, PAS S3
  assert.equal(validateManifest(m).reason, 'offset');
});

test('validateManifest : une part manquante → parts (intent : exiger les 5 partitions)', () => {
  const m = goodManifest(); m.parts.pop();
  assert.equal(validateManifest(m).reason, 'parts');
});

test('validateManifest : offset dupliqué (donc un manquant) → offset (intent : couvrir la garde pigeonhole)', () => {
  const m = goodManifest(); m.parts[1].offset = OFFSETS.bootloader;   // 2 parts à 0x0, 0x8000 disparaît
  assert.equal(validateManifest(m).reason, 'offset');
});

test('planParts : blobs présents → fileArray trié par offset (intent : ordre de flash déterministe)', () => {
  const scrambled = {
    version: 'v1.2.3',
    parts: [
      { path: 'littlefs.bin',   offset: OFFSETS.fs },
      { path: 'bootloader.bin', offset: OFFSETS.bootloader },
      { path: 'firmware.bin',   offset: OFFSETS.app },
      { path: 'boot_app0.bin',  offset: OFFSETS.boot_app0 },
      { path: 'partitions.bin', offset: OFFSETS.partitions },
    ],
  };
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': app(), 'littlefs.bin': raw() };
  const r = planParts(scrambled, blobs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fileArray.map(f => f.address), [OFFSETS.bootloader, OFFSETS.partitions, OFFSETS.boot_app0, OFFSETS.app, OFFSETS.fs]);
  assert.ok(r.fileArray[3].data instanceof Uint8Array);
});

test('planParts : blob manquant → missing_blob (intent : ne pas flasher une part vide)', () => {
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': app() };  // pas de littlefs
  assert.equal(planParts(goodManifest(), blobs).reason, 'missing_blob');
});

test('planParts : blob présent mais vide → missing_blob (intent : ne pas flasher une part de 0 octet)', () => {
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': app(), 'littlefs.bin': new Uint8Array(0) };
  assert.equal(planParts(goodManifest(), blobs).reason, 'missing_blob');
});

test('planParts : manifest non conforme → shape sans throw (intent : couvrir la garde défensive)', () => {
  assert.equal(planParts(null, {}).reason, 'shape');
});

test('planParts : image app sans magic 0xE9 → app_magic (intent : anti-brick, réutilise validateBinary)', () => {
  const blobs = { 'bootloader.bin': raw(), 'partitions.bin': raw(), 'boot_app0.bin': raw(), 'firmware.bin': raw(), 'littlefs.bin': raw() };
  assert.equal(planParts(goodManifest(), blobs).reason, 'app_magic');
});

test('weightedProgress : tous les fichiers finis → 1 (intent : la barre atteint bien 100%)', () => {
  assert.equal(weightedProgress([1, 1, 1], [10, 20, 70]), 1);
});

test('weightedProgress : rien fait → 0 (intent : départ à 0%)', () => {
  assert.equal(weightedProgress([0, 0], [5, 5]), 0);
});

test('weightedProgress : pondéré par la taille non-compressée (intent : le gros fichier domine, pas le nombre de parts)', () => {
  // petit fichier fini, gros pas commencé → ~10%, PAS 50% (ce que donnerait une moyenne non pondérée)
  assert.equal(weightedProgress([1, 0], [1, 9]), 0.1);
});

test('weightedProgress : fracs plus court que weights → parts non commencées à 0 (intent : robuste au reporting par fichier)', () => {
  assert.equal(weightedProgress([1], [1, 1]), 0.5);   // 1re part finie sur 2 de même poids
});

test('weightedProgress : poids total nul → 0 sans throw (intent : défensif)', () => {
  assert.equal(weightedProgress([], []), 0);
});

test('weightedProgress : args non-tableaux → 0 sans throw (intent : garde défensive Gemini)', () => {
  assert.equal(weightedProgress(null, undefined), 0);
  assert.equal(weightedProgress('x', 5), 0);
});

test('planParts : part malformée (offset non numérique) → shape sans throw (intent : garde par-élément)', () => {
  // on appelle planParts directement (hors validateManifest) avec une part cassée
  const m = { version: 'v1', parts: [{ path: 'firmware.bin', offset: '0x10000' }, ...goodManifest().parts.slice(1)] };
  assert.equal(planParts(m, {}).reason, 'shape');
});

test('planParts : part nulle → shape sans throw (intent : garde par-élément)', () => {
  const m = { version: 'v1', parts: [null, ...goodManifest().parts.slice(1)] };
  assert.equal(planParts(m, {}).reason, 'shape');
});

// Logique PURE du flash USB (Web Serial) : validation du manifest hébergé + planification des parts.
// Aucun DOM/réseau/série → testée node. Défensif (entrée non conforme → résultat, jamais throw), comme ota-plan.js.
import { validateBinary } from './ota-plan.js';

// Offsets des 5 images d'un device vierge (dialboard_16MB.csv ; ESP32-S3 : bootloader @0x0, PAS 0x1000).
export const OFFSETS = { bootloader: 0x0, partitions: 0x8000, boot_app0: 0xe000, app: 0x10000, fs: 0x810000 };
const EXPECTED = new Set(Object.values(OFFSETS));   // les 5 offsets attendus, exactement

// obj → { ok, reason }. reason ∈ null | 'shape' | 'version' | 'parts' | 'offset'.
export function validateManifest(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'shape' };
  if (typeof obj.version !== 'string' || !obj.version) return { ok: false, reason: 'version' };
  const parts = obj.parts;
  if (!Array.isArray(parts) || parts.length !== EXPECTED.size) return { ok: false, reason: 'parts' };
  const seen = new Set();
  for (const p of parts) {
    if (!p || typeof p.path !== 'string' || !p.path) return { ok: false, reason: 'parts' };
    if (!EXPECTED.has(p.offset)) return { ok: false, reason: 'offset' };
    seen.add(p.offset);
  }
  if (seen.size !== EXPECTED.size) return { ok: false, reason: 'offset' };   // doublon → un offset manque
  return { ok: true, reason: null };
}

// (manifest, blobs:{path→Uint8Array}) → { ok, fileArray?, reason? }. fileArray trié par offset croissant.
// reason ∈ 'shape' | 'missing_blob' | 'app_magic'. Réutilise validateBinary (magic 0xE9) sur l'image app.
export function planParts(manifest, blobs) {
  if (!manifest || !Array.isArray(manifest.parts)) return { ok: false, reason: 'shape' };
  const parts = [...manifest.parts].sort((a, b) => a.offset - b.offset);
  const fileArray = [];
  for (const p of parts) {
    const data = blobs && blobs[p.path];
    if (!(data instanceof Uint8Array) || data.length === 0) return { ok: false, reason: 'missing_blob' };
    if (p.offset === OFFSETS.app && !validateBinary(data, 'firmware').ok) return { ok: false, reason: 'app_magic' };
    fileArray.push({ data, address: p.offset });
  }
  return { ok: true, fileArray };
}

// Progression pondérée d'un flash multi-parts. fracs[i] = avancement du fichier i (0..1, robuste à la
// compression car esptool reporte written/total dans la MÊME unité) ; weights[i] = taille non-compressée.
// → fraction globale 0..1 qui monte fluide jusqu'à 1 (le gros littlefs domine le poids). fracs plus court
// que weights → parts non commencées comptées à 0. Défensif : total nul → 0.
export function weightedProgress(fracs, weights) {
  let done = 0, total = 0;
  for (let i = 0; i < weights.length; i++) { total += weights[i]; done += (fracs[i] || 0) * weights[i]; }
  return total ? done / total : 0;
}

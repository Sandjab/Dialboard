// Logique PURE de l'OTA (validation anti-brick + planification de sequence). Aucun DOM/reseau → testee node.
// Defensif (fonctions exportees, cf. convention projet) : entree non conforme → resultat, jamais throw.

// Tailles de partition (dialboard_16MB.csv) : slot app OTA et partition FS (spiffs).
export const PART = { app: 0x400000, spiffs: 0x7E0000 };

// bytes (Uint8Array) + kind ('firmware'|'fs') → { ok, reason }. reason ∈ null | 'empty' |
// 'firmware_magic' | 'firmware_too_big' | 'fs_looks_like_firmware' | 'fs_too_big' (l'UI mappe → ota.err.<reason>).
export function validateBinary(bytes, kind, part = PART) {
  if (!bytes || !bytes.length) return { ok: false, reason: 'empty' };
  const magic = bytes[0] === 0xE9;                        // 0xE9 = magic d'une image applicative ESP
  if (kind === 'firmware') {
    if (!magic) return { ok: false, reason: 'firmware_magic' };
    if (bytes.length > part.app) return { ok: false, reason: 'firmware_too_big' };
    return { ok: true, reason: null };
  }
  // kind === 'fs'
  if (magic) return { ok: false, reason: 'fs_looks_like_firmware' };   // un firmware dans le champ FS = brick
  if (bytes.length > part.spiffs) return { ok: false, reason: 'fs_too_big' };
  return { ok: true, reason: null };
}

// { hasFw, hasFs, sdMounted } → liste ordonnee d'etapes { op[, assets] }. op ∈ 'backup' | 'flashFs' |
// 'flashFw' | 'reboot' | 'wait' | 'restore'. FS avant firmware (reboot auto du fw remonte le FS) ;
// fs seul → reboot explicite ; restore.assets = !sdMounted (avec SD les assets survivent au /fs).
export function planFlash({ hasFw, hasFs, sdMounted } = {}) {
  const steps = [];
  if (hasFs) { steps.push({ op: 'backup' }); steps.push({ op: 'flashFs' }); }
  if (hasFw) steps.push({ op: 'flashFw' });          // reboot automatique
  else if (hasFs) steps.push({ op: 'reboot' });      // fs seul : reboot explicite pour remonter le FS
  if (hasFw || hasFs) steps.push({ op: 'wait' });
  if (hasFs) steps.push({ op: 'restore', assets: !sdMounted });
  return steps;
}

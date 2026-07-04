// Overlay OTA : selection firmware/FS → validation anti-brick → backup → flash → reboot → attente → restore.
// Modele sur publish-dialog.js (mount(model,{...}), open/close via .hidden). DOM + orchestration : browser-verified.
import { validateBinary, planFlash } from './ota-plan.js';
import { encodeBundle } from './bundle.js';
import { referencedKeys } from './bg-image.js';
import { referencedImageKeys } from './image-asset.js';
import { referencedAimgKeys } from './image-anim-asset.js';
import {
  getStatus, loadLayout, pushLayout,
  postFirmware, postFs, rebootDevice, waitForDevice,
  fetchBgImage, fetchImage, fetchAimg, uploadBgImage, uploadImage, uploadAimg,
} from './device.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

export function mountOtaDialog(model, options) {
  const { openBtn, overlay, getBase, onBusy } = options || {};   // onBusy(bool) optionnel : partage le verrou « une seule I/O device » d'app.js
  if (!model || !openBtn || !overlay || typeof getBase !== 'function') return;
  const $ = id => overlay.querySelector('#' + id);
  const warn = $('ota-warn'), submit = $('ota-submit'), progress = $('ota-progress'), bar = $('ota-bar'), log = $('ota-log');
  const fw = { input: $('ota-fw'), err: $('ota-fw-err'), bytes: null };
  const fs = { input: $('ota-fs'), err: $('ota-fs-err'), bytes: null };
  let sdMounted = false, busy = false;

  const setBar = (frac) => { progress.hidden = false; bar.style.width = Math.round(frac * 100) + '%'; };
  const clearLog = () => { log.textContent = ''; progress.hidden = true; bar.style.width = '0'; };
  const logStep = (op) => { const li = document.createElement('li'); li.textContent = t('ota.step.' + op); log.appendChild(li); };
  const logErr = (msg) => { const li = document.createElement('li'); li.className = 'err'; li.textContent = msg; log.appendChild(li); };

  const refresh = () => {                                   // arme le bouton : au moins un fichier valide, aucun invalide
    const anyErr = fw.err.textContent || fs.err.textContent;
    submit.disabled = busy || !!anyErr || (!fw.bytes && !fs.bytes);
  };

  // Lit un <input file> → octets + validation → message d'erreur i18n (ou vide). kind ∈ 'firmware'|'fs'.
  async function onPick(slot, kind) {
    slot.bytes = null; slot.err.textContent = '';
    const file = slot.input.files[0];
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const v = validateBinary(bytes, kind);
      if (v.ok) slot.bytes = bytes;
      else slot.err.textContent = t('ota.err.' + v.reason);
    }
    refresh();
  }
  fw.input.addEventListener('change', () => onPick(fw, 'firmware'));
  fs.input.addEventListener('change', () => onPick(fs, 'fs'));

  // Backup device (layout toujours ; assets ssi includeAssets). Un GET reseau qui echoue propage (l'orchestration stoppe).
  async function backupDevice(base, includeAssets) {
    const layout = await loadLayout(base);
    const layoutText = JSON.stringify(layout);
    const assets = { bg: {}, image: {}, aimg: {} };
    if (includeAssets) {
      for (const k of referencedKeys(layout))      { const b = await fetchBgImage(base, k); if (b) assets.bg[k] = b; }
      for (const k of referencedImageKeys(layout)) { const b = await fetchImage(base, k);   if (b) assets.image[k] = b; }
      for (const k of referencedAimgKeys(layout))  { const b = await fetchAimg(base, k);    if (b) assets.aimg[k] = b; }
    }
    return { layoutText, assets };
  }
  async function restoreDevice(base, backup, includeAssets) {
    await pushLayout(base, backup.layoutText);
    if (includeAssets) {
      for (const [k, b] of Object.entries(backup.assets.bg))    await uploadBgImage(base, k, b);
      for (const [k, b] of Object.entries(backup.assets.image)) await uploadImage(base, k, b);
      for (const [k, b] of Object.entries(backup.assets.aimg))  await uploadAimg(base, k, b);
    }
  }
  // /firmware reboote au succes : une coupure (TypeError) APRES upload complet (frac ~1) = reboot attendu, tranche par
  // waitForDevice. Une coupure a mi-transfert (frac < 0.99) = vrai echec → rethrow (sinon fausse reussite sans rien flasher).
  async function flashFirmware(base, bytes) {
    let frac = 0;
    try { await postFirmware(base, bytes, f => { frac = f; setBar(f); }); }
    catch (e) { if (!(e instanceof TypeError) || frac < 0.99) throw e; }
  }
  // /reboot envoie 200 avant de redemarrer, mais la coupure peut preceder la reponse : tolerer TypeError (waitForDevice tranche).
  async function rebootQuietly(base) {
    try { await rebootDevice(base); }
    catch (e) { if (!(e instanceof TypeError)) throw e; }
  }

  async function run() {
    const base = getBase();
    if (!base) return void showToast(t('toast.device_url_q'));
    if (submit.disabled) return;
    busy = true; refresh(); clearLog();
    if (onBusy) onBusy(true);                                // grise les boutons device d'app.js pendant le flash
    try {
      const status = await getStatus(base);
      sdMounted = !!(status && status.sd && status.sd.mounted);
      const steps = planFlash({ hasFw: !!fw.bytes, hasFs: !!fs.bytes, sdMounted });
      let backup = null;
      for (const step of steps) {
        logStep(step.op); progress.hidden = true; bar.style.width = '0';
        if (step.op === 'backup') {
          try { backup = await backupDevice(base, !sdMounted); }
          catch (e) { throw new Error(!sdMounted ? t('ota.backup_incomplete') : e.message); }   // pas de SD → ne pas flasher sur un backup rate
        }
        else if (step.op === 'flashFs') await postFs(base, fs.bytes, setBar);
        else if (step.op === 'flashFw') await flashFirmware(base, fw.bytes);
        else if (step.op === 'reboot')  await rebootQuietly(base);
        else if (step.op === 'wait')    { if (!await waitForDevice(base)) throw new Error(t('ota.reconnect_timeout')); }
        else if (step.op === 'restore') await restoreDevice(base, backup, step.assets);
      }
      showToast(t('ota.done'), { kind: 'ok', ms: 5000 });
      close();
    } catch (e) {
      logErr(e.message);
      showToast(t('ota.failed', { msg: e.message }), { kind: 'warn', ms: 6000 });
    } finally { busy = false; refresh(); if (onBusy) onBusy(false); }
  }

  // Bouton « sauvegarde .dboard » : bundle COMPLET (layout + tous les assets references), filet universel.
  $('ota-backup').addEventListener('click', async () => {
    if (busy) return;                                        // pas de GET concurrent pendant un flash (invariant une I/O device)
    const base = getBase();
    if (!base) return void showToast(t('toast.device_url_q'));
    try {
      const b = await backupDevice(base, true);
      const text = encodeBundle(b.layoutText, b.assets);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'device-backup.dboard'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) { showToast(t('ota.failed', { msg: e.message }), { kind: 'warn', ms: 6000 }); }
  });

  const open = async () => {
    overlay.hidden = false; clearLog();
    fw.input.value = ''; fs.input.value = ''; fw.bytes = fs.bytes = null;
    fw.err.textContent = ''; fs.err.textContent = ''; refresh();
    const base = getBase();
    try { const s = await getStatus(base); sdMounted = !!(s && s.sd && s.sd.mounted); }
    catch (e) { sdMounted = false; }
    warn.textContent = t(sdMounted ? 'ota.warn.sd' : 'ota.warn.nosd');
  };
  const close = () => { overlay.hidden = true; };
  openBtn.addEventListener('click', open);
  $('ota-cancel').addEventListener('click', () => { if (!busy) close(); });   // pas de fermeture aveugle en plein flash
  overlay.addEventListener('click', e => { if (e.target === overlay && !busy) close(); });
  submit.addEventListener('click', run);
}

// Overlay « Nouveau device » : fetch manifest same-origine → affiche la version → requestPort() → flashDevice.
// Ossature calquée sur ota-dialog.js. flash/requestPort/hasSerial injectables → testable en mock (Task 5). Browser-verified.
import { validateManifest, planParts } from './usb-plan.js';
import { flashDevice } from './serial.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

export function mountUsbDialog(options) {
  const {
    openBtn, overlay, manifestUrl,
    flash = flashDevice,                                   // injectable pour le mock
    requestPort = () => navigator.serial.requestPort(),    // injectable pour le mock
    hasSerial = ('serial' in navigator),                   // injectable pour le mock
  } = options || {};
  if (!openBtn || !overlay || typeof manifestUrl !== 'string') return;
  const $ = id => overlay.querySelector('#' + id);
  const intro = $('usb-intro'), unsupported = $('usb-unsupported'), versionEl = $('usb-version');
  const erase = $('usb-erase'), submit = $('usb-submit'), progress = $('usb-progress'), bar = $('usb-bar'), log = $('usb-log');
  let manifest = null, busy = false;

  const setBar = (frac) => { progress.hidden = false; bar.style.width = Math.round(frac * 100) + '%'; };
  const clearLog = () => { log.textContent = ''; progress.hidden = true; bar.style.width = '0'; };
  const logStep = (op, arg) => { const li = document.createElement('li'); li.textContent = t('usb.step.' + op, arg ? { chip: arg } : undefined); log.appendChild(li); };
  const logErr = (msg) => { const li = document.createElement('li'); li.className = 'err'; li.textContent = msg; log.appendChild(li); };

  // Charge le manifest same-origine + affiche la version. Manifest 404/invalide → indisponible.
  async function loadManifest() {
    versionEl.textContent = ''; manifest = null;
    try {
      const res = await fetch(manifestUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const obj = await res.json();
      if (!validateManifest(obj).ok) throw new Error('invalid manifest');
      manifest = obj;
      versionEl.textContent = t('usb.version', { version: obj.version });
    } catch (e) { versionEl.textContent = t('usb.unavailable'); }
    refresh();
  }
  const refresh = () => { submit.disabled = busy || !hasSerial || !manifest; };

  async function run() {
    if (submit.disabled) return;
    busy = true; refresh(); clearLog();
    try {
      // requestPort() EN PREMIER : l'activation transitoire du geste utilisateur ne survivrait pas à l'await
      // d'un download de ~8 Mo (littlefs) → requestPort planterait. On télécharge APRÈS, mais EN PARALLÈLE.
      const port = await requestPort();
      const blobs = {};
      await Promise.all(manifest.parts.map(async (p) => {           // 5 blobs same-origine en parallèle
        const url = new URL(p.path, new URL(manifestUrl, location.href)).href;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(t('usb.fetch_failed', { msg: p.path + ' HTTP ' + res.status }));
        blobs[p.path] = new Uint8Array(await res.arrayBuffer());
      }));
      const plan = planParts(manifest, blobs);
      if (!plan.ok) throw new Error(t('usb.bad_release'));
      await flash(port, plan.fileArray, { onProgress: setBar, onLog: logStep, eraseAll: erase.checked });
      close();
      showToast(t('usb.done'), { kind: 'ok', ms: 10000 });
    } catch (e) {
      if (e && (e.name === 'NotFoundError' || e.name === 'AbortError')) return;   // annulation du choix de port → silencieux (finally réarme)
      logErr(e.message);
      logErr(t('usb.bootloader_hint'));                    // repli bootloader (auto-reset raté possible)
      showToast(t('usb.failed', { msg: e.message }), { kind: 'warn', ms: 6000 });
    } finally { busy = false; refresh(); }
  }

  const open = async () => {
    overlay.hidden = false; clearLog();
    erase.checked = false;
    unsupported.hidden = hasSerial; intro.hidden = !hasSerial;   // hors Chromium : message d'aide, pas de flash
    await loadManifest();
  };
  const close = () => { overlay.hidden = true; };
  openBtn.addEventListener('click', open);
  $('usb-cancel').addEventListener('click', () => { if (!busy) close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay && !busy) close(); });
  submit.addEventListener('click', run);
}

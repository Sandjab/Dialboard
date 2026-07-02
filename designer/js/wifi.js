import { getWifi, scanWifi, addWifi, removeWifi } from './device.js';

// Présentation de GET /wifi pour le panneau — séparée du transport (testable node).
// Ne remonte QUE des SSID + un drapeau « connecté » ; aucun mot de passe (write-only).
export function formatWifiList(data) {
  const d = (data && typeof data === 'object') ? data : {};
  const connected = typeof d.connected === 'string' ? d.connected : '';
  const nets = Array.isArray(d.nets) ? d.nets.filter(s => typeof s === 'string') : [];
  return nets.map(ssid => ({ ssid, connected: ssid === connected }));
}

// petit helper : crée un élément avec un texte (textContent -> pas d'injection HTML)
function el(tag, text) { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; }

// Monte le panneau WiFi dans `root`. getBase()->URL device ; t()->i18n ; toast(msg, opts)->feedback
// (même signature que showToast : opts.kind par défaut 'err', d'où le kind:'ok' explicite sur les
// verdicts de succès — cf. invariant designer « un toast = verdict d'une action »).
export function createWifiPanel(root, { getBase, t, toast }) {
  root.replaceChildren();
  const refreshBtn = el('button', '⟳'); refreshBtn.type = 'button'; refreshBtn.className = 'wifi-refresh';
  const list = el('ul'); list.className = 'wifi-list';
  const form = el('form'); form.className = 'wifi-add';
  const ssid = el('input'); ssid.className = 'wifi-ssid'; ssid.required = true; ssid.setAttribute('list', 'wifi-scan');
  const scan = el('datalist'); scan.id = 'wifi-scan';
  const pass = el('input'); pass.className = 'wifi-pass'; pass.type = 'password'; pass.autocomplete = 'new-password';
  const save = el('button', t('wifi.add')); save.type = 'submit'; save.className = 'wifi-save';
  form.append(ssid, scan, pass, save);
  root.append(refreshBtn, list, form);

  async function refresh() {
    const base = getBase();
    try {
      const rows = formatWifiList(await getWifi(base));
      list.replaceChildren();
      for (const r of rows) {
        const li = el('li', r.ssid + (r.connected ? ' ●' : ''));
        const del = el('button', '✕');
        del.onclick = async () => { await removeWifi(base, r.ssid); toast(t('wifi.removed'), { kind: 'ok' }); refresh(); };
        li.append(del);
        list.append(li);
      }
      scan.replaceChildren();
      for (const n of await scanWifi(base).catch(() => [])) {
        const opt = el('option'); opt.value = n.ssid;   // .value = attribut -> pas d'injection
        scan.append(opt);
      }
    } catch (e) { toast(t('wifi.err')); }
  }

  refreshBtn.onclick = refresh;
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await addWifi(getBase(), ssid.value, pass.value); pass.value = ''; toast(t('wifi.added'), { kind: 'ok' }); refresh(); }
    catch (err) { toast(t('wifi.err')); }
  };
  return { refresh };
}

// Preload desktop : découverte mDNS auto. Capacité desktop-only → vit ici, pas dans designer/.
// Contrat designer (zéro-touch) : poser #base.value puis dispatcher « change » déclenche le check
// de connexion (probeConnection) et la pastille. Aucune modif de designer/ requise.
const { contextBridge, ipcRenderer } = require('electron');

// i18n du picker mDNS : ce preload (CommonJS) n'a pas accès au catalogue ES du renderer. Le renderer lui
// pousse les libellés traduits via setMdnsLabels (calqué sur setMenuLabels). Défauts EN = fallback si le
// renderer ne pousse rien (langue par défaut = anglais). `applyMdnsLabels` est défini dans le handler
// DOMContentLoaded (où vivent les éléments DOM) ; le pont le rappelle quand de nouveaux libellés arrivent.
let mdnsLabels = {
  picker_title: 'Detected devices (mDNS)',
  rescan_title: 'Rescan the network (mDNS)',
  picker_placeholder: '{count} devices…',
  device_default_name: 'dialboard',
};
let applyMdnsLabels = () => {};
const interp = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] !== undefined ? String(p[k]) : m));

// Pont desktop pour les fichiers locaux (.dboard). Exposé au renderer ; le designer l'utilise s'il existe.
contextBridge.exposeInMainWorld('desktop', {
  openBundle: () => ipcRenderer.invoke('file:open'),
  saveBundle: (text, path) => ipcRenderer.invoke('file:save', { text, path }),
  saveBundleAs: (text) => ipcRenderer.invoke('file:saveAs', { text }),
  onMenu: (cb) => { ipcRenderer.removeAllListeners('menu'); ipcRenderer.on('menu', (_e, action) => cb(action)); },
  setTitle: (name) => ipcRenderer.invoke('window:setTitle', name),
  setMenuLabels: (labels) => ipcRenderer.invoke('menu:setLabels', labels),
  setMdnsLabels: (labels) => { mdnsLabels = { ...mdnsLabels, ...(labels || {}) }; applyMdnsLabels(); },
});

window.addEventListener('DOMContentLoaded', () => {
  const base = document.getElementById('base');
  if (!base) return;

  const setUrl = (url) => { base.value = url; base.dispatchEvent(new Event('change')); };

  // UI injectée à côté du champ URL : sélecteur (si plusieurs) + bouton re-scan.
  const box = document.createElement('span');
  box.style.marginLeft = '6px';
  const picker = document.createElement('select');
  picker.style.display = 'none';
  picker.title = mdnsLabels.picker_title;
  picker.addEventListener('change', () => { if (picker.value) setUrl(picker.value); });
  const rescan = document.createElement('button');
  rescan.type = 'button';
  rescan.textContent = '⟳';
  rescan.title = mdnsLabels.rescan_title;
  rescan.addEventListener('click', () => scan());
  box.appendChild(picker);
  box.appendChild(rescan);
  base.insertAdjacentElement('afterend', box);

  let lastList = [];
  function renderPicker(list) {
    lastList = list;
    picker.replaceChildren();
    if (list.length < 2) { picker.style.display = 'none'; return; }
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = interp(mdnsLabels.picker_placeholder, { count: list.length });
    picker.appendChild(ph);
    for (const d of list) {
      const o = document.createElement('option');
      o.value = d.url; o.textContent = `${d.name || mdnsLabels.device_default_name} — ${d.url}`;
      picker.appendChild(o);
    }
    picker.style.display = '';
  }

  // Rappelé par le pont setMdnsLabels quand le renderer pousse des libellés traduits (au boot / après reload).
  applyMdnsLabels = () => {
    picker.title = mdnsLabels.picker_title;
    rescan.title = mdnsLabels.rescan_title;
    renderPicker(lastList);
  };

  async function scan() {
    rescan.disabled = true;
    let list = [];
    try { list = await ipcRenderer.invoke('discover-devices'); } catch (e) { list = []; }
    rescan.disabled = false;
    renderPicker(list);
    if (list.length === 1 && document.activeElement !== base) setUrl(list[0].url);   // 1 device → remplissage direct (sauf si le champ est en cours d'édition)
  }

  scan();
});

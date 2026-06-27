// Preload desktop : découverte mDNS auto. Capacité desktop-only → vit ici, pas dans designer/.
// Contrat designer (zéro-touch) : poser #base.value puis dispatcher « change » déclenche le check
// de connexion (probeConnection) et la pastille. Aucune modif de designer/ requise.
const { contextBridge, ipcRenderer } = require('electron');

// Pont desktop pour les fichiers locaux (.dboard). Exposé au renderer ; le designer l'utilise s'il existe.
contextBridge.exposeInMainWorld('desktop', {
  openBundle: () => ipcRenderer.invoke('file:open'),
  saveBundle: (text, path) => ipcRenderer.invoke('file:save', { text, path }),
  saveBundleAs: (text) => ipcRenderer.invoke('file:saveAs', { text }),
  onMenu: (cb) => { ipcRenderer.removeAllListeners('menu'); ipcRenderer.on('menu', (_e, action) => cb(action)); },
  setTitle: (name) => ipcRenderer.invoke('window:setTitle', name),
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
  picker.title = 'Devices détectés (mDNS)';
  picker.addEventListener('change', () => { if (picker.value) setUrl(picker.value); });
  const rescan = document.createElement('button');
  rescan.type = 'button';
  rescan.textContent = '⟳';
  rescan.title = 'Re-scanner le réseau (mDNS)';
  rescan.addEventListener('click', () => scan());
  box.appendChild(picker);
  box.appendChild(rescan);
  base.insertAdjacentElement('afterend', box);

  function renderPicker(list) {
    picker.replaceChildren();
    if (list.length < 2) { picker.style.display = 'none'; return; }
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = `${list.length} devices…`;
    picker.appendChild(ph);
    for (const d of list) {
      const o = document.createElement('option');
      o.value = d.url; o.textContent = `${d.name || 'dialboard'} — ${d.url}`;
      picker.appendChild(o);
    }
    picker.style.display = '';
  }

  async function scan() {
    rescan.disabled = true;
    let list = [];
    try { list = await ipcRenderer.invoke('discover-devices'); } catch (e) { list = []; }
    rescan.disabled = false;
    renderPicker(list);
    if (list.length === 1) setUrl(list[0].url);   // 1 device → remplissage direct
  }

  scan();
});

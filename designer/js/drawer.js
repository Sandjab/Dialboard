// Tiroir Device (Phase 7, spec §5) : slide-over latéral droit, deux onglets [Sorties physiques | Sources pull].
// Héberge les panneaux existants (#device via device-panel.js, #sources via sources.js — montés par app.js,
// inchangés). Géré ici : ouverture/fermeture (bouton ⚙ toolbar, ✕, Échap, clic backdrop) + bascule d'onglet.
// Câblage DOM, vérifié navigateur (aucune logique pure → pas de test node, cf. convention projet).
export function createDrawer(root, { toggleBtn }) {
  const backdrop = root.querySelector('.drawer-backdrop');
  const closeBtn = root.querySelector('.drawer-close');
  const tabs = [...root.querySelectorAll('.drawer-tab')];   // dataset.tab = 'device' | 'sources'
  const panes = { device: root.querySelector('#device-pane'), sources: root.querySelector('#sources-pane') };

  const setTab = (name) => {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
  };
  const open = () => { root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden = !root.hidden; };

  toggleBtn.onclick = toggle;
  closeBtn.onclick = close;
  backdrop.onclick = close;
  tabs.forEach(t => { t.onclick = () => setTab(t.dataset.tab); });
  // Échap ferme le tiroir s'il est ouvert (ne consomme rien si fermé ; cohabite avec l'Échap global d'app.js).
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  setTab('device');   // onglet par défaut : Sorties physiques
  return { open, close, toggle };
}

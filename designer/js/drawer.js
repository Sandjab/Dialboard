// Tiroir « Sources » : slide-over latéral droit hébergeant le panneau des sources pull (#sources,
// monté par app.js). Géré ici : ouverture/fermeture (bouton toolbar, ✕, Échap, clic backdrop).
// Câblage DOM, vérifié navigateur (aucune logique pure → pas de test node, cf. convention projet).
export function createDrawer(root, { toggleBtn, onOpen }) {
  const backdrop = root.querySelector('.drawer-backdrop');
  const closeBtn = root.querySelector('.drawer-close');
  const open = () => { onOpen && onOpen(); root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden ? open() : close(); };

  toggleBtn.onclick = toggle;
  closeBtn.onclick = close;
  backdrop.onclick = close;
  // Échap ferme le tiroir s'il est ouvert (cohabite avec l'Échap global d'app.js).
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  return { open, close, toggle };
}

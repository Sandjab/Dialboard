// Toast éphémère : notification non bloquante, auto-disparition. Aucune dépendance ; un hôte unique
// (créé à la 1re utilisation) empile les toasts en bas de l'écran. Câblage DOM, vérifié au navigateur.
let host = null;

export function showToast(message, { kind = 'err', ms = 2600 } = {}) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + kind;
  t.textContent = message;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));   // déclenche la transition d'entrée
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);                    // retire après la transition de sortie
  }, ms);
}

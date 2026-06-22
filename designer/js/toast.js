// Toasts unifiés (modèle A) : une pile unique (haut-droite), non bloquante. Deux usages :
//  - showToast(msg, {kind}) : verdict instantané auto-disparaissant (export, doublon de nom, import…).
//  - makeToast(msg) : toast de PROGRESSION (spinner) pour une I/O device ; son handle .morph(msg, kind)
//    le mue EN PLACE en verdict (pas de second toast, pas de clignotement), puis il auto-disparaît.
// Câblage DOM, vérifié au navigateur (convention projet : node --test sans DOM → pas de test ici).
let host = null;

function ensureHost() {
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  return host;
}

// Monte un toast (texte + spinner optionnel) et renvoie { node, label }.
function mount(message, kind, spinner) {
  const node = document.createElement('div');
  node.className = 'toast toast-' + kind;
  if (spinner) { const sp = document.createElement('span'); sp.className = 'toast-spinner'; node.appendChild(sp); }
  const label = document.createElement('span');
  label.className = 'toast-label';
  label.textContent = message;
  node.appendChild(label);
  ensureHost().appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));   // déclenche la transition d'entrée
  return { node, label };
}

// Retrait avec transition de sortie.
function leave(node) {
  node.classList.remove('show');
  setTimeout(() => node.remove(), 200);
}

// Verdict instantané : auto-disparition après ms. (kind 'err' par défaut — compat des appels existants.)
export function showToast(message, { kind = 'err', ms = 2600 } = {}) {
  const { node } = mount(message, kind, false);
  setTimeout(() => leave(node), ms);
}

// Toast de progression (spinner), muable en verdict via le handle renvoyé. Ne disparaît pas tant que
// morph() ou dismiss() n'a pas été appelé (une I/O en vol reste visible). morph()/dismiss() sont idempotents.
export function makeToast(message) {
  const { node, label } = mount(message, 'progress', true);
  let settled = false;
  return {
    // Mue le toast progress en verdict EN PLACE : retire le spinner, repasse la classe en ok/err,
    // change le texte, puis auto-disparaît après ms.
    morph(msg, kind = 'ok', { ms = 2600 } = {}) {
      if (settled) return; settled = true;
      const sp = node.querySelector('.toast-spinner'); if (sp) sp.remove();
      node.className = 'toast toast-' + kind + ' show';
      label.textContent = msg;
      setTimeout(() => leave(node), ms);
    },
    // Ferme sans verdict (cas rare : abandon).
    dismiss() { if (settled) return; settled = true; leave(node); }
  };
}

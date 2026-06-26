// Journaux de la console designer (outillage de debug). Trois anneaux bornés en mémoire :
//   activity — actions notables (CRUD composant/page, undo/redo, ops device, import/export, nouveau) ;
//   js       — console.log/info/warn/error capturés (installConsoleCapture) ;
//   net      — échanges device (instrumentés dans device.js : méthode, chemin, code HTTP, durée).
// Les lignes ne sont PAS persistées (vidées au reload) ; seules les cases d'affichage vivent dans les
// settings. La factory createLogStore est pure (testée node) ; installConsoleCapture a un effet de bord
// (patch de console.*) et n'est appelée qu'au boot — JAMAIS au top-level (casserait les tests node).

export function createLogStore({ max = 200, now = () => new Date() } = {}) {
  const rings = { activity: [], js: [], net: [] };
  const subs = new Set();
  const emit = () => subs.forEach(fn => fn());
  const push = (kind, entry) => {
    const ring = rings[kind];
    ring.push({ t: now(), ...entry });
    if (ring.length > max) ring.shift();   // anneau borné : la plus ancienne sort
    emit();
  };
  return {
    logActivity(message) { push('activity', { message: String(message) }); },
    logJs(level, message) { push('js', { level, message: String(message) }); },
    logNet({ method, path, status, ms, ok }) { push('net', { method, path, status, ms, ok: !!ok }); },
    get(kind) { return rings[kind] ? rings[kind].slice() : []; },   // copie : l'appelant ne mute pas l'anneau
    clear(kind) { if (rings[kind]) { rings[kind].length = 0; emit(); } },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

// Singleton partagé app/device/console.
export const logs = createLogStore();

// Patche console.log/info/warn/error pour dupliquer vers le journal JS, puis délègue à l'original.
// Idempotent. Le format des args est best-effort (chaîne / message d'Error / JSON). La capture est
// gardée par try/catch pour qu'un échec de log ne masque jamais le message d'origine.
let installed = false;
export function installConsoleCapture(store = logs) {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try { store.logJs(level, args.map(fmtArg).join(' ')); } catch (e) { /* ne jamais avaler le log d'origine */ }
      orig(...args);
    };
  }
}

function fmtArg(a) {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.message;
  try { return JSON.stringify(a); } catch (e) { return String(a); }
}

// Valeurs d'aperçu éditables (mock). HORS layout : non persistées, non poussées au device ;
// remplacées à l'exécution réelle par POST /update. Clé = id de composant.
import { MOCKS } from './render.js';

const store = new Map();

// Renvoie le mock (mutable) d'un composant ; l'initialise depuis le défaut de son type au 1er accès.
export function getMock(id, type) {
  if (!store.has(id)) store.set(id, structuredClone(MOCKS[type] ?? {}));
  return store.get(id);
}

// Fusionne un patch dans le mock d'un composant.
export function setMock(id, patch) {
  const m = store.get(id) ?? {};
  Object.assign(m, patch);
  store.set(id, m);
}

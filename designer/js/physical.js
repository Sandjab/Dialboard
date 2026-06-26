// Helpers « composants physiques » (sorties device globales : led_ring, sound). PURS (testés node).
// Source de vérité des types : le flag `physical` du registre. Les physiques vivent dans `components`
// SANS placement ; le firmware les pilote globalement (cf. spec 2026-06-18-rt-physical-device-zone).
import { COMPONENTS } from './registry.js';
import { uniqueId, addComponent } from './mutations.js';

export function isPhysicalType(type) {
  return !!COMPONENTS[type]?.physical;
}

export function physicalTypes() {
  return Object.keys(COMPONENTS).filter(t => COMPONENTS[t].physical);
}

export function physicalComponentIds(state) {
  const comps = state.components || {};
  return Object.keys(comps).filter(id => isPhysicalType(comps[id].type));
}

// Ajoute un composant physique global : entrée dans `components`, AUCUN placement. Retourne l'id.
export function addPhysicalComponent(state, type) {
  const id = uniqueId(state, type);
  addComponent(state, id, COMPONENTS[type].defaults());
  return id;
}

// Supprime un composant de `components` ET retire tout placement le référençant sur toutes les pages.
export function removeComponent(state, id) {
  if (state.components) delete state.components[id];
  for (const page of state.pages || []) {
    if (page.place) page.place = page.place.filter(pl => pl.ref !== id);
  }
}

// Migration : retire les placements dont le composant référencé est physique (composants conservés).
export function stripPhysicalPlacements(state) {
  const comps = state.components || {};
  for (const page of state.pages || []) {
    if (page.place) page.place = page.place.filter(pl => !isPhysicalType(comps[pl.ref]?.type));
  }
}

// Cardinalité : un type marqué `singleton` (ex. led_ring) ne peut exister qu'en un exemplaire.
export function canAddType(state, type) {
  if (!COMPONENTS[type]?.singleton) return true;
  return !Object.values(state.components || {}).some(c => c.type === type);
}

// Migration : garantit la présence d'UN composant de chaque type physique (led_ring, sound).
// Si aucun composant d'un type n'existe, en injecte un avec l'id par défaut du registre (led / buzz),
// ou un id dé-dupliqué <type><n> si cet id est déjà pris par autre chose. Idempotent.
// Legacy multi-sound : laissé tel quel (un sound existe déjà → no-op, pas de collapse).
export function ensurePhysicals(state) {
  state.components ||= {};
  for (const type of physicalTypes()) {
    if (Object.values(state.components).some(c => c.type === type)) continue;
    let id = COMPONENTS[type].defaultId ?? uniqueId(state, type);   // pas de defaultId (futur type) → fallback <type><n> au lieu d'une clé "undefined"
    if (state.components[id]) id = uniqueId(state, type);   // id par défaut pris par autre chose → fallback
    addComponent(state, id, COMPONENTS[type].defaults());
  }
}

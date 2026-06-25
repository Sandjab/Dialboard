// Réglages d'édition du designer : store pur (défauts + normalisation/clamp), persistance
// localStorage, application des variables CSS. Le DOM du tiroir est ajouté en bas (createSettings).
// Pur testé node ; load/save/apply touchent localStorage/DOM (non testés node, cf. convention).
const KEY = 'rt-designer-settings';
const STEPS = [4, 8, 16];

export function defaultSettings() {
  return { ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 8 };
}

export function normalizeSettings(raw) {
  const d = defaultSettings();
  const r = (raw && typeof raw === 'object') ? raw : {};
  const op = Number(r.ghostOpacity);
  return {
    ghostOpacity: Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : d.ghostOpacity,
    gridShow: typeof r.gridShow === 'boolean' ? r.gridShow : d.gridShow,
    gridSnap: typeof r.gridSnap === 'boolean' ? r.gridSnap : d.gridSnap,
    gridStep: STEPS.includes(r.gridStep) ? r.gridStep : d.gridStep,
  };
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(KEY))); }
  catch (e) { return defaultSettings(); }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}

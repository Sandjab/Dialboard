// Réglages d'édition du designer : store pur (défauts + normalisation/clamp), persistance
// localStorage, application des variables CSS. Le DOM du tiroir est ajouté en bas (createSettings).
// Pur testé node ; load/save/apply touchent localStorage/DOM (non testés node, cf. convention).
const KEY = 'rt-designer-settings';
const STEPS = [5, 10, 20];

export function defaultSettings() {
  return { ghostOpacity: 0.38, gridShow: false, gridSnap: false, gridStep: 10 };
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

// Applique les réglages VISUELS au DOM : variable d'opacité (racine) + classe/pas de grille (stage).
export function applyVisualSettings(s) {
  document.documentElement.style.setProperty('--ghost-opacity', String(s.ghostOpacity));
  const wrap = document.getElementById('stage-wrap');
  if (wrap) {
    wrap.classList.toggle('grid-on', s.gridShow);
    wrap.style.setProperty('--grid-step', s.gridStep + 'px');
  }
}

// --- DOM du tiroir Settings (vérifié au navigateur ; pas de test node, cf. convention). ---
function settingRow(labelText) {
  const row = document.createElement('div'); row.className = 'set-row';
  const label = document.createElement('label'); label.textContent = labelText;
  const line = document.createElement('div'); line.className = 'set-line';
  row.append(label, line);
  return row;
}
function checkbox(checked, onChange) {
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked;
  c.onchange = () => onChange(c.checked);
  return c;
}
// Confirmation inline : 1er clic arme (« Confirmer ? » 3 s), 2e clic exécute. Pas de dialog natif.
function withConfirm(btn, action) {
  const orig = btn.textContent; let armed = false, t = null;
  btn.onclick = () => {
    if (!armed) {
      armed = true; btn.textContent = 'Confirmer ?'; btn.classList.add('confirm');
      t = setTimeout(() => { armed = false; btn.textContent = orig; btn.classList.remove('confirm'); }, 3000);
      return;
    }
    clearTimeout(t); armed = false; btn.textContent = orig; btn.classList.remove('confirm'); action();
  };
}

export function createSettings(root, { toggleBtn, onOpen, getSettings, setSettings, onNewLayout }) {
  const backdrop = root.querySelector('.drawer-backdrop');
  const closeBtn = root.querySelector('.drawer-close');
  const pane = root.querySelector('#settings');

  const open = () => { onOpen && onOpen(); root.hidden = false; };
  const close = () => { root.hidden = true; };
  const toggle = () => { root.hidden ? open() : close(); };
  toggleBtn.onclick = toggle;
  closeBtn.onclick = close;
  backdrop.onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  function build() {
    const s = getSettings();
    pane.replaceChildren();   // vide le panneau (équivalent sûr de innerHTML='')

    // Transparence des invisibles
    const opRow = settingRow('Transparence des invisibles');
    const op = document.createElement('input');
    op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.02'; op.value = String(s.ghostOpacity);
    const opVal = document.createElement('span'); opVal.className = 'set-val'; opVal.textContent = s.ghostOpacity.toFixed(2);
    op.oninput = () => { opVal.textContent = Number(op.value).toFixed(2); setSettings({ ghostOpacity: Number(op.value) }); };
    opRow.querySelector('.set-line').append(op, opVal);
    pane.appendChild(opRow);

    // Afficher la grille
    const gridRow = settingRow('Afficher la grille');
    gridRow.querySelector('.set-line').appendChild(checkbox(s.gridShow, v => setSettings({ gridShow: v })));
    pane.appendChild(gridRow);

    // Aimanter (snap)
    const snapRow = settingRow('Aimanter au pas (snap)');
    snapRow.querySelector('.set-line').appendChild(checkbox(s.gridSnap, v => setSettings({ gridSnap: v })));
    pane.appendChild(snapRow);

    // Pas de la grille
    const stepRow = settingRow('Pas de la grille');
    const step = document.createElement('select');
    for (const v of [5, 10, 20]) {
      const o = document.createElement('option'); o.value = String(v); o.textContent = v + ' px';
      if (v === s.gridStep) o.selected = true; step.appendChild(o);
    }
    step.onchange = () => setSettings({ gridStep: Number(step.value) });
    stepRow.querySelector('.set-line').appendChild(step);
    pane.appendChild(stepRow);

    // Actions
    const actions = document.createElement('div'); actions.className = 'set-actions';
    const neww = document.createElement('button'); neww.className = 'set-btn'; neww.type = 'button'; neww.textContent = 'Nouveau (layout vierge)';
    withConfirm(neww, () => onNewLayout && onNewLayout());
    const reset = document.createElement('button'); reset.className = 'set-btn'; reset.type = 'button'; reset.textContent = 'Réinitialiser les réglages';
    reset.onclick = () => { setSettings(defaultSettings()); build(); };   // reconstruit pour resync les contrôles
    actions.append(neww, reset);
    pane.appendChild(actions);
  }

  build();
  return { open, close, toggle };
}

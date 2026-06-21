import { createModel } from './model.js';
import { createValidator } from './validate.js';
import { bindJsonView } from './json-view.js';
import { loadLayout, pushLayout, captureScreenshot, getStatus, setDevicePage, pushValues, uploadBgImage, fetchBgImage, uploadImage, fetchImage, uploadAimg, fetchAimg } from './device.js';
import { referencedKeys, cacheBytes, cachePut, previewUrl } from './bg-image.js';
import { referencedImageKeys, cacheBytes as imageCacheBytes, previewUrl as imagePreviewUrl, rehydrate as rehydrateImage } from './image-asset.js';
import { referencedAimgKeys, packBytes as aimgPackBytes, previewUrl as aimgPreviewUrl, rehydrate as rehydrateAimg } from './image-anim-asset.js';
import { getMock } from './mocks.js';
import { createCanvas } from './canvas.js';
import { createPalette } from './palette.js';
import { createInspector } from './inspector.js';
import { createPages } from './pages.js';
import { bindFileIO } from './file-io.js';
import { createSources } from './sources.js';
import { createDevicePanel } from './device-panel.js';
import { stripPhysicalPlacements } from './physical.js';
import { showToast } from './toast.js';
import { resolveShortcut, isEditableTarget } from './shortcuts.js';
import { placeComponentCopy, duplicateComponent, removePlacementAndOrphan } from './mutations.js';

const $ = id => document.getElementById(id);

// Construit un payload POST /update depuis les valeurs d'aperçu (mocks) des composants data.
// Format par type (cf. README §/update) : scalaire pour readout/bar/meter/led, {pct,reset_in_s} pour ring,
// dernier point d'historique pour chart. label/led_ring/sound : pas de valeur de test pertinente.
function buildUpdatePayload(state) {
  const out = {};
  for (const [id, c] of Object.entries(state.components || {})) {
    const m = getMock(id, c.type);
    if (c.type === 'readout' || c.type === 'bar' || c.type === 'meter' || c.type === 'led') out[id] = m.value ?? 0;
    else if (c.type === 'ring') { out[id] = { pct: m.value ?? 0 }; if (c.countdown && m.reset_in_s != null) out[id].reset_in_s = m.reset_in_s; }
    else if (c.type === 'chart') { const h = m.hist || []; if (h.length) out[id] = h[h.length - 1]; }
  }
  return out;
}

async function main() {
  // Le schema partage vit dans ../schema (hors du dossier designer) : servir depuis le parent.
  let schema;
  try {
    const r = await fetch('../schema/layout.schema.json');
    if (!r.ok) throw new Error(`HTTP ${r.status} — servir depuis Dialboard/, pas designer/`);
    schema = await r.json();
  } catch (e) {
    const s = document.getElementById('status');
    s.textContent = 'Erreur init schema : ' + e.message;
    s.className = 'status err';
    return;
  }
  const validate = createValidator(schema);
  // Autosave : restaure le dernier layout édité (localStorage) ou repart du défaut ; persiste à chaque modif.
  // Filet anti-perte : un reload accidentel ne perd plus le travail non exporté/poussé.
  const SAVE_KEY = 'rt-designer-layout';
  let saved;
  try { const s = localStorage.getItem(SAVE_KEY); if (s) saved = JSON.parse(s); } catch (e) {}
  if (saved) stripPhysicalPlacements(saved);   // migration : physiques jamais attachés à une page
  const model = createModel(saved);
  model.subscribe(() => { try { localStorage.setItem(SAVE_KEY, model.toJSON()); } catch (e) {} });

  let inspector;
  // Canvas WYSIWYG (page active). onSelect → inspecteur.
  const canvas = createCanvas({ stage: $('stage') }, model, {
    onSelect: s => inspector.select(s),
    onLiveMove: p => inspector.setLivePlacement(p)   // MAJ live des champs Placement pendant le drag
  });
  inspector = createInspector($('inspector'), model, {
    rerenderCanvas: canvas.render,
    clearSelection: () => canvas.selectPlacement(null),
    getActivePage: canvas.getActivePage,
    previewProp: canvas.previewProp,
    clearPreview: canvas.clearPreview,
    pushVisible: async (id, visible) => {
      if (!$('base').value) { setStatus('URL device ?', 'err'); return false; }
      setStatus('Visibilité…');
      try {
        await pushValues($('base').value, { [id]: { visible } });
        setStatus(visible ? 'Affiché sur le device' : 'Caché sur le device', 'ok');
        return true;
      } catch (e) { setStatus('Échec : ' + e.message, 'err'); return false; }
    }
  });

  // Palette : glisser un type depuis la palette sur le canvas pour créer un composant
  // sur la page active, puis sélection du nouveau placement.
  createPalette($('palette'), model, {
    stage: $('stage'),
    getActivePage: canvas.getActivePage,
    onCreated: i => canvas.selectPlacement(i)
  });

  // Onglets de pages : sélectionner la page active + CRUD + réordonner.
  const pages = createPages($('pages'), model, {
    getActivePage: canvas.getActivePage,
    setPage: i => canvas.setPage(i)
  });

  // Export / import fichier layout.json (filet indépendant du device). Après import, on revient à la
  // page 1 (l'ancienne page active peut ne plus exister) et on rafraîchit les onglets.
  bindFileIO(model, {
    exportBtn: $('export'), importBtn: $('import'), importInput: $('import-file'),
    onLoad: () => { model.commit(s => stripPhysicalPlacements(s)); canvas.setPage(0); pages.render(); }
  });

  // Panneau Sources (pull réseau) : édition des sources top-level. Indépendant du canvas/pages.
  createSources($('sources'), model);
  // Panneau Device : composants physiques (led_ring/sound) édités hors pages (sorties globales).
  createDevicePanel($('device'), model);

  bindJsonView(model, {
    textarea: $('json'), applyBtn: $('apply'), validEl: $('valid'), errorsEl: $('errors'), warningsEl: $('warnings')
  }, validate);

  const syncUndo = () => { $('undo').disabled = !model.canUndo(); $('redo').disabled = !model.canRedo(); };
  model.subscribe(syncUndo); syncUndo();
  $('undo').onclick = () => { $('json').blur(); model.undo(); };
  $('redo').onclick = () => { $('json').blur(); model.redo(); };

  // Presse-papier interne (session) : copie indépendante d'un composant + son placement, sans id.
  let clipboard = null;

  // Raccourcis clavier globaux : Cmd/Ctrl+Z = annuler, +Shift+Z = rétablir, Échap = désélectionner,
  // Cmd/Ctrl+D = dupliquer, +C = copier, +V = coller (copies indépendantes ; coller sur la page
  // active = réutilisation cross-page), Suppr = retirer de la page active. Inactifs dans un champ.
  document.addEventListener('keydown', e => {
    const action = resolveShortcut({
      key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
      editable: isEditableTarget(e.target)
    });
    if (!action) return;
    if (action === 'undo') { e.preventDefault(); if (model.canUndo()) model.undo(); return; }
    if (action === 'redo') { e.preventDefault(); if (model.canRedo()) model.redo(); return; }
    if (action === 'deselect') {
      if (canvas.getSelected() == null) return;
      e.preventDefault();
      canvas.selectPlacement(null);
      return;
    }
    if (action === 'copy') {
      const sel = canvas.getSelected();
      if (sel == null) return;
      const pl = model.state.pages?.[canvas.getActivePage()]?.place?.[sel];
      const cd = pl && model.state.components?.[pl.ref];
      if (!cd) return;
      e.preventDefault();
      clipboard = { compDef: structuredClone(cd), placement: structuredClone(pl) };
      return;
    }
    if (action === 'paste') {
      if (!clipboard) return;
      e.preventDefault();
      let ni = -1;
      model.commit(s => { ni = placeComponentCopy(s, canvas.getActivePage(), clipboard.compDef, clipboard.placement); });
      if (ni >= 0) canvas.selectPlacement(ni);          // sélectionne la copie après re-render
      return;
    }
    if (action === 'duplicate') {
      const sel = canvas.getSelected();
      if (sel == null) return;
      e.preventDefault();
      let ni = -1;
      model.commit(s => { ni = duplicateComponent(s, canvas.getActivePage(), sel); });
      if (ni >= 0) canvas.selectPlacement(ni);
      return;
    }
    // delete : ne consomme la touche que s'il y a une sélection.
    const sel = canvas.getSelected();
    if (sel == null) return;
    e.preventDefault();
    canvas.selectPlacement(null);                       // désélectionne avant le commit (cf. inspector.js)
    model.commit(s => removePlacementAndOrphan(s, canvas.getActivePage(), sel));
  });

  // Clic ailleurs que sur un composant → désélectionne : zone vide du disque, coins, marge, palette,
  // en-tête… Exclus : un composant (.w — son propre pointerdown le sélectionne) et l'inspecteur
  // (il édite la sélection, le désélectionner au clic le rendrait inutilisable).
  document.addEventListener('pointerdown', e => {
    if (canvas.getSelected() == null) return;
    if (e.target.closest('.w') || e.target.closest('#inspector')) return;
    canvas.selectPlacement(null);
  });

  // Zoom d'affichage du canvas (visuel uniquement — le layout reste en unités écran). Persisté comme
  // l'autosave du layout : un reload ne réinitialise pas l'échelle de travail choisie.
  const ZOOM_KEY = 'rt-designer-zoom';
  const ZOOM_ALLOWED = ['1', '1.5', '2'];
  const stageWrap = $('stage-wrap'), zoomSel = $('zoom');
  const applyZoom = v => stageWrap.style.setProperty('--zoom', v);
  let savedZoom = '1';
  try { const z = localStorage.getItem(ZOOM_KEY); if (ZOOM_ALLOWED.includes(z)) savedZoom = z; } catch (e) {}
  zoomSel.value = savedZoom; applyZoom(savedZoom);
  zoomSel.onchange = () => { applyZoom(zoomSel.value); try { localStorage.setItem(ZOOM_KEY, zoomSel.value); } catch (e) {} };

  // URL du device : pré-remplie pour éviter le piège « URL device ? » dès la 1re action. Quand le designer
  // est servi PAR le device (embarqué : http://<ip>/designer/), location.origin EST le device. En dev local
  // (localhost/file), on restaure plutôt la dernière URL saisie (localStorage) ; sinon le placeholder reste.
  const BASE_KEY = 'rt-designer-base';
  const baseInput = $('base');
  let savedBase = ''; try { savedBase = localStorage.getItem(BASE_KEY) || ''; } catch (e) {}
  const isLocalDev = location.protocol === 'file:' || /\/\/(localhost|127\.0\.0\.1)\b/.test(location.origin);
  baseInput.value = savedBase || (isLocalDev ? '' : location.origin);
  baseInput.addEventListener('change', () => { try { localStorage.setItem(BASE_KEY, baseInput.value); } catch (e) {} });

  // La barre #status garde la trace (dont la progression « … » sans kind) ; un verdict ok/err part aussi
  // en toast (échec rouge / succès vert) — plus visible que la petite barre. Cf. toast.js.
  const setStatus = (msg, kind) => {
    $('status').textContent = msg; $('status').className = 'status' + (kind ? ' ' + kind : '');
    if (kind === 'ok' || kind === 'err') showToast(msg, { kind });
  };
  $('load').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    setStatus('Chargement…');
    try {
      const base = $('base').value;
      const lay = await loadLayout(base);
      stripPhysicalPlacements(lay);            // migration avant chargement dans le modèle
      model.loadJSON(JSON.stringify(lay));
      for (const k of referencedKeys(model.state)) {
        if (!previewUrl(k)) { const b = await fetchBgImage(base, k); if (b) cachePut(k, b); }
      }
      for (const [id, ic] of Object.entries(model.state.components || {})) {
        // garde w/h > 0 : un layout edite a la main sans dimensions ferait throw createImageData(0,0)
        if (ic.type === 'image_anim' && ic.src && ic.w > 0 && ic.h > 0 && ic.frames > 0 && !aimgPreviewUrl(ic.src)) {
          const b = await fetchAimg(base, ic.src);
          if (b) rehydrateAimg(ic.src, b, ic.w, ic.h, ic.frames);
        }
        if (ic.type !== 'image' || !ic.src || !(ic.w > 0) || !(ic.h > 0) || imagePreviewUrl(ic.src)) continue;
        const b = await fetchImage(base, ic.src);
        if (b) rehydrateImage(ic.src, id, b, ic.w, ic.h);
      }
      setStatus('Chargé', 'ok');
    }
    catch (e) { setStatus('Échec : ' + e.message + ' (CORS ? cf. README)', 'err'); }
  };
  $('push').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    if ($('json').value.trim() !== model.toJSON().trim()) return setStatus('Modifs JSON non appliquées — clique « Appliquer » d’abord', 'err');
    if (!validate(model.state).valid) return setStatus('Layout invalide', 'err');
    setStatus('Envoi…');
    try {
      const base = $('base').value;
      for (const k of referencedKeys(model.state)) {
        const bytes = cacheBytes(k);
        if (bytes) await uploadBgImage(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      for (const k of referencedImageKeys(model.state)) {
        const bytes = imageCacheBytes(k);
        if (bytes) await uploadImage(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      for (const k of referencedAimgKeys(model.state)) {
        const bytes = aimgPackBytes(k);
        if (bytes) await uploadAimg(base, k, bytes);   // avant pushLayout (le sweep tourne au POST /layout)
      }
      await pushLayout(base, model.toJSON());
      setStatus('Poussé et persisté', 'ok');
    }
    catch (e) { setStatus('Échec : ' + e.message + ' (CORS ? cf. README)', 'err'); }
  };
  // --- Boucle device : santé (/status), valeurs de test (/update), capture + navigation (/page + /screenshot) ---
  const devbar = $('devbar');
  const renderStatus = (s) => {
    const srcs = (s.sources || []).map(x => `${x.name || '?'}:${x.last_status === 200 ? 'ok' : (x.err_count ? 'err' : '…')}`).join(' ');
    devbar.className = 'devbar'; devbar.hidden = false;
    devbar.textContent = `● ${s.ip} · page ${(+s.page) + 1}/${s.pages} · up ${s.uptime_s}s · ${s.components} comp.` + (srcs ? ` · sources ${srcs}` : '');
  };
  $('statusbtn').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    setStatus('Statut…');
    try { renderStatus(await getStatus($('base').value)); setStatus('Statut OK', 'ok'); }
    catch (e) { devbar.hidden = false; devbar.className = 'devbar err'; devbar.textContent = '○ injoignable : ' + e.message; setStatus('Échec statut', 'err'); }
  };
  $('values').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    const payload = buildUpdatePayload(model.state);
    if (!Object.keys(payload).length) return setStatus('Aucune valeur de test à pousser', 'err');
    setStatus('Valeurs…');
    try { const r = await pushValues($('base').value, payload); setStatus(`Valeurs poussées (${r.updated ?? '?'})`, 'ok'); }
    catch (e) { setStatus('Échec : ' + e.message, 'err'); }
  };

  // Capture écran (+ navigation device dans l'overlay). Révoque l'ancienne blob URL (anti-fuite).
  const shot = $('shot');
  const doCapture = async () => {
    const url = await captureScreenshot($('base').value);
    if (shot.dataset.url) URL.revokeObjectURL(shot.dataset.url);
    shot.dataset.url = url; shot.src = url;
  };
  const refreshShotPage = async () => {
    try { const s = await getStatus($('base').value); $('shot-page').textContent = `page ${(+s.page) + 1}/${s.pages}`; }
    catch (e) { $('shot-page').textContent = ''; }
  };
  $('capture').onclick = async () => {
    if (!$('base').value) return setStatus('URL device ?', 'err');
    setStatus('Capture…');
    try { await doCapture(); await refreshShotPage(); $('shot-overlay').hidden = false; setStatus('Capturé', 'ok'); }
    catch (e) { setStatus('Échec : ' + e.message + ' (CORS ? cf. README)', 'err'); }
  };
  const navAndCapture = async (dir) => {
    if (!$('base').value) return;
    setStatus('Navigation…');
    try {
      await setDevicePage($('base').value, { dir });
      await new Promise(r => setTimeout(r, 350));   // laisse le device basculer + sync avant la capture
      await doCapture(); await refreshShotPage(); setStatus('Capturé', 'ok');
    } catch (e) { setStatus('Échec : ' + e.message, 'err'); }
  };
  $('shot-prev').onclick = () => navAndCapture('prev');
  $('shot-next').onclick = () => navAndCapture('next');
  $('shot-close').onclick = () => { $('shot-overlay').hidden = true; };
}

main();

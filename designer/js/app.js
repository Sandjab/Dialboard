import { createModel } from './model.js';
import { createValidator } from './validate.js';
import { createStatusbar } from './statusbar.js';
import { createConsole } from './console.js';
import { createDrawer } from './drawer.js';
import { loadLayout, pushLayout, captureScreenshot, getStatus, setDevicePage, pushValues, uploadBgImage, fetchBgImage, uploadImage, fetchImage, uploadAimg, fetchAimg, formatDeviceStatus } from './device.js';
import { referencedKeys, cacheBytes, cachePut, previewUrl } from './bg-image.js';
import { referencedImageKeys, cacheBytes as imageCacheBytes, previewUrl as imagePreviewUrl, rehydrate as rehydrateImage } from './image-asset.js';
import { referencedAimgKeys, packBytes as aimgPackBytes, previewUrl as aimgPreviewUrl, rehydrate as rehydrateAimg } from './image-anim-asset.js';
import { getMock } from './mocks.js';
import { createCanvas } from './canvas.js';
import { createPalette } from './palette.js';
import { createInspector } from './inspector.js';
import { createTree } from './tree.js';
import { createCarousel } from './carousel.js';
import { bindFileIO } from './file-io.js';
import { createSources } from './sources.js';
import { createDevicePanel } from './device-panel.js';
import { stripPhysicalPlacements } from './physical.js';
import { showToast, makeToast } from './toast.js';
import { resolveShortcut, isEditableTarget } from './shortcuts.js';
import { placeComponentCopy, duplicateComponent, removePlacementAndOrphan } from './mutations.js';
import { createSelection, sameSelection, isSelectionValid } from './selection.js';

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
    showToast('Erreur init schema : ' + e.message, { kind: 'err', ms: 6000 });
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

  // Sélection partagée (canvas ↔ inspecteur ↔ futur arbre). Coordinateur = garde F1 centralisé :
  // avant tout changement RÉEL de sélection, si un champ de l'inspecteur a le focus, le blur. Cela
  // (a) committe l'édition en attente sur l'ANCIENNE sélection (closure à ref figée — F5) et (b) lève
  // le garde-focus de render() pour que l'inspecteur se reconstruise sur la nouvelle sélection.
  // Démarrage sur le nœud Document (Option 1) : l'inspecteur montre les globales au lancement plutôt que
  // le placeholder vide. Échap ramène ensuite à null (placeholder) ; un clic dans le vide du canvas ne
  // désélectionne que depuis un composant (garde getSelected()==null préexistante). placementSelection({kind:
  // 'doc'}) = null → aucune surbrillance canvas ; les raccourcis copier/coller/suppr lisent canvas.getSelected()
  // (index de placement), indépendant de la sélection doc.
  const selection = createSelection({ kind: 'doc' });
  const setSelection = (next) => {
    if (!sameSelection(selection.get(), next)) {
      const insp = $('inspector');
      if (insp.contains(document.activeElement) && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }
    selection.set(next);
  };
  // Purge d'une sélection périmée après suppression / undo / import (l'index ne pointe plus rien).
  model.subscribe(() => { if (!isSelectionValid(model.state, selection.get())) setSelection(null); });

  let inspector;
  // Canvas WYSIWYG (page active). Lit/écrit la sélection partagée.
  const canvas = createCanvas({ stage: $('stage') }, model, {
    selection, setSelection,
    onLiveMove: p => inspector.setLivePlacement(p)   // MAJ live des champs Placement pendant le drag
  });
  inspector = createInspector($('inspector'), model, {
    selection,
    rerenderCanvas: canvas.render,
    clearSelection: () => setSelection(null),
    getActivePage: canvas.getActivePage,
    previewProp: canvas.previewProp,
    clearPreview: canvas.clearPreview,
    openDrawer: () => drawer.open(),
    pushVisible: async (id, visible) => {
      const base = $('base').value;
      if (!base) { showToast('URL device ?'); return false; }
      // withBusy renvoie le texte de succès (truthy) ou undefined (échec/ré-entrée) → booléen pour l'inspecteur.
      const r = await withBusy(visible ? 'Affichage…' : 'Masquage…', async () => {
        await pushValues(base, { [id]: { visible } });
        return visible ? 'Affiché sur le device' : 'Caché sur le device';
      });
      return r !== undefined;
    }
  });

  // Palette : glisser un type depuis la palette sur le canvas pour créer un composant
  // sur la page active, puis sélection du nouveau placement.
  createPalette($('palette'), model, {
    stage: $('stage'),
    getActivePage: canvas.getActivePage,
    onCreated: i => canvas.selectPlacement(i)
  });

  // Presse-papier interne (session) : copie indépendante d'un composant + son placement, sans id.
  let clipboard = null;
  // Actions composant réutilisables (raccourcis clavier ET menu contextuel de l'arbre). Opèrent sur la
  // sélection courante (page active + index), donc la ligne cliquée-droit doit être sélectionnée avant.
  const compActions = {
    copy() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      const pl = model.state.pages?.[canvas.getActivePage()]?.place?.[sel];
      const cd = pl && model.state.components?.[pl.ref];
      if (!cd) return;
      clipboard = { compDef: structuredClone(cd), placement: structuredClone(pl) };
    },
    paste() {
      if (!clipboard) return;
      let ni = -1;
      model.commit(s => { ni = placeComponentCopy(s, canvas.getActivePage(), clipboard.compDef, clipboard.placement); });
      if (ni >= 0) canvas.selectPlacement(ni);
    },
    duplicate() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      let ni = -1;
      model.commit(s => { ni = duplicateComponent(s, canvas.getActivePage(), sel); });
      if (ni >= 0) canvas.selectPlacement(ni);
    },
    remove() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      canvas.selectPlacement(null);
      model.commit(s => removePlacementAndOrphan(s, canvas.getActivePage(), sel));
    },
    cut() { compActions.copy(); compActions.remove(); },
  };
  const getClipboard = () => clipboard;

  // Arbre des calques (dock gauche) : pilote la page active + CRUD pages + sélection (remplace nav#pages).
  const tree = createTree($('layers'), model, {
    selection, setSelection,
    getActivePage: canvas.getActivePage,
    setPage: i => canvas.setPage(i),
    compActions, getClipboard,
  });

  // Carousel de vignettes de pages (sous le hero disque) : navigation visuelle rapide.
  createCarousel({ host: $('carousel') }, model, {
    selection, setSelection,
    getActivePage: canvas.getActivePage,
    setPage: i => canvas.setPage(i),
  });

  // Export / import fichier layout.json (filet indépendant du device). Après import, on revient à la
  // page 1 (l'ancienne page active peut ne plus exister) et on rafraîchit l'arbre.
  bindFileIO(model, {
    exportBtn: $('export'), importBtn: $('import'), importInput: $('import-file'),
    onLoad: () => { model.commit(s => stripPhysicalPlacements(s)); canvas.setPage(0); tree.render(); }
  });

  // Panneau Sources (pull réseau) : édition des sources top-level. Indépendant du canvas/pages.
  createSources($('sources'), model);
  // Panneau Device : composants physiques (led_ring/sound) édités hors pages (sorties globales).
  createDevicePanel($('device'), model);
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle') });

  const dconsole = createConsole($('console'), model, { validate });
  createStatusbar($('statusbar'), model, { selection, validate, onValidClick: () => dconsole.open('problems') });

  const syncUndo = () => { $('undo').disabled = !model.canUndo(); $('redo').disabled = !model.canRedo(); };
  model.subscribe(syncUndo); syncUndo();
  $('undo').onclick = () => { model.undo(); };
  $('redo').onclick = () => { model.redo(); };

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
    if (action === 'rename') {
      const s = selection.get();
      if (!s || s.kind === 'doc') return;   // rien / Document : pas de renommage inline → laisser la touche
      e.preventDefault();
      tree.beginRename();
      return;
    }
    if (action === 'deselect') {
      if (selection.get() == null) return;   // toute sélection (doc/page/comp), pas seulement un composant
      e.preventDefault();
      setSelection(null);
      return;
    }
    if (action === 'copy') {
      if (canvas.getSelected() == null) return;   // rien à copier → laisser la copie native
      e.preventDefault();
      compActions.copy();
      return;
    }
    if (action === 'paste') {
      if (!clipboard) return;
      e.preventDefault();
      compActions.paste();
      return;
    }
    if (action === 'duplicate') {
      if (canvas.getSelected() == null) return;
      e.preventDefault();
      compActions.duplicate();
      return;
    }
    // delete : ne consomme la touche que s'il y a une sélection.
    if (canvas.getSelected() == null) return;
    e.preventDefault();
    compActions.remove();
  });

  // Clic ailleurs que sur un composant → désélectionne : zone vide du disque, coins, marge, palette,
  // en-tête… Exclus : un composant (.w — son propre pointerdown le sélectionne), l'inspecteur
  // (il édite la sélection, le désélectionner au clic le rendrait inutilisable) et l'arbre des calques
  // (#layers — surface de sélection : ses propres clics gèrent doc/page/comp ; l'œil garde la sélection).
  document.addEventListener('pointerdown', e => {
    if (canvas.getSelected() == null) return;
    if (e.target.closest('.w') || e.target.closest('#inspector') || e.target.closest('#layers')) return;
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

  // --- Notifications unifiées + verrou busy (modèle A, cf. spec §3) ---
  // Une seule I/O device en vol à la fois : `busy` bloque la ré-entrée (double-clic) ET désactive les
  // boutons device (feedback visuel). Les éditions locales (inspecteur/arbre/undo) ne sont PAS bloquées.
  const deviceBtns = ['load', 'push', 'values', 'statusbtn', 'capture', 'shot-prev', 'shot-next'].map($);
  let busy = false;
  const setDeviceBusy = (b) => { busy = b; for (const el of deviceBtns) if (el) el.disabled = b; };

  // withBusy(progressMsg, fn) : pose un toast progress (spinner), sérialise l'I/O, mue le toast en
  // verdict. fn renvoie le texte de succès (string) ; une exception → verdict d'échec. Le suffixe
  // « réseau/CORS » n'apparaît que sur un vrai échec réseau (fetch rejette → TypeError), pas sur un
  // HTTP 4xx ni une validation. Renvoie le texte de succès, ou undefined si échec/ré-entrée
  // (pushVisible s'en sert pour signaler le succès à l'inspecteur).
  async function withBusy(progressMsg, fn) {
    // Ré-entrée bloquée. Les boutons device principaux sont déjà grisés ; mais le bouton « visibilité »
    // de l'inspecteur n'en fait pas partie → un toast donne le retour qui manquerait sinon (no-op muet).
    if (busy) { showToast('Opération device en cours…'); return undefined; }
    const t = makeToast(progressMsg);
    setDeviceBusy(true);
    try {
      const okMsg = await fn();
      t.morph(typeof okMsg === 'string' ? okMsg : 'Terminé', 'ok');
      return okMsg;
    } catch (e) {
      const hint = e instanceof TypeError ? ' (réseau/CORS ? cf. README)' : '';
      t.morph('Échec : ' + e.message + hint, 'err');
      return undefined;
    } finally {
      setDeviceBusy(false);
    }
  }
  $('load').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Chargement…', async () => {
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
      return 'Chargé';
    });
  };
  $('push').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    if (!validate(model.state).valid) return void showToast('Layout invalide');
    withBusy('Envoi…', async () => {
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
      return 'Poussé et persisté';
    });
  };
  // --- Boucle device : santé (/status), valeurs de test (/update), capture + navigation (/page + /screenshot) ---
  // Pastille device (toolbar) : état de connexion permanent (modèle A). Paresseuse — « ○ non vérifié »
  // au boot, renseignée à la 1re requête Statut (succès → ● ip + détail en infobulle ; échec → ○ injoignable).
  const devPill = $('dev-pill');
  const setDevicePill = (kind, label, tooltip = '') => {
    devPill.className = 'dev-pill' + (kind ? ' ' + kind : '');
    devPill.textContent = label;
    devPill.title = tooltip;
  };
  $('statusbtn').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Statut…', async () => {
      try {
        const f = formatDeviceStatus(await getStatus(base));
        setDevicePill('ok', f.label, f.tooltip);
        return 'Statut OK';
      } catch (e) {
        setDevicePill('err', '○ injoignable', e.message);
        throw e;
      }
    });
  };
  $('values').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    const payload = buildUpdatePayload(model.state);
    if (!Object.keys(payload).length) return void showToast('Aucune valeur de test à pousser');
    withBusy('Valeurs…', async () => {
      const r = await pushValues(base, payload);
      return `Valeurs poussées (${r.updated ?? '?'})`;
    });
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
  $('capture').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast('URL device ?');
    withBusy('Capture…', async () => {
      await doCapture(); await refreshShotPage(); $('shot-overlay').hidden = false;
      return 'Capturé';
    });
  };
  const navAndCapture = (dir) => {
    const base = $('base').value;
    if (!base) return;
    withBusy('Navigation…', async () => {
      await setDevicePage(base, { dir });
      await new Promise(r => setTimeout(r, 350));   // laisse le device basculer + sync avant la capture
      await doCapture(); await refreshShotPage();
      return 'Capturé';
    });
  };
  $('shot-prev').onclick = () => navAndCapture('prev');
  $('shot-next').onclick = () => navAndCapture('next');
  $('shot-close').onclick = () => { $('shot-overlay').hidden = true; };
}

main();

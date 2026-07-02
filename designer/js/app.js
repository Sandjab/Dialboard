import { createModel } from './model.js';
import { createValidator } from './validate.js';
import { createStatusbar } from './statusbar.js';
import { createConsole } from './console.js';
import { createDrawer } from './drawer.js';
import { loadLayout, pushLayout, captureScreenshot, getStatus, getContext, setDevicePage, pushValues, uploadBgImage, fetchBgImage, uploadImage, fetchImage, uploadAimg, fetchAimg, formatDeviceStatus } from './device.js';
import { referencedKeys, cacheBytes, cachePut, previewUrl } from './bg-image.js';
import { referencedImageKeys, cacheBytes as imageCacheBytes, previewUrl as imagePreviewUrl, rehydrate as rehydrateImage } from './image-asset.js';
import { referencedAimgKeys, packBytes as aimgPackBytes, previewUrl as aimgPreviewUrl, rehydrate as rehydrateAimg } from './image-anim-asset.js';
import { getMock } from './mocks.js';
import { createCanvas } from './canvas.js';
import { createPalette } from './palette.js';
import { BOARD_W, BOARD_H } from './canvas-zones.js';
import { createInspector } from './inspector.js';
import { createTree } from './tree.js';
import { createCarousel } from './carousel.js';
import { bindFileIO } from './file-io.js';
import { createSources } from './sources.js';
import { createSinks } from './sinks.js';
import { stripPhysicalPlacements, ensurePhysicals, pruneOrphans } from './physical.js';
import { showToast, makeToast } from './toast.js';
import { withConfirm } from './confirm.js';
import { resolveShortcut, isEditableTarget } from './shortcuts.js';
import { placeComponentCopy, duplicateComponent, removePlacementAndOrphan } from './mutations.js';
import { createSelection, sameSelection, isSelectionValid } from './selection.js';
import { loadSettings, saveSettings, normalizeSettings, applyVisualSettings, createSettings } from './settings.js';
import { logs, installConsoleCapture } from './logs.js';
import { initI18n, applyStaticI18n, t, availableLanguages, currentLang } from './i18n.js';
import { DEFAULT_LAYOUT } from './default-layout.js';
import { serializeBundle, loadBundle } from './bundle.js';

const $ = id => document.getElementById(id);

// Construit un payload POST /update depuis les valeurs d'aperçu (mocks) des composants data.
// Format par type (cf. README §/update) : scalaire pour readout/bar/meter/led, {pct,reset_in_s} pour ring,
// dernier point d'historique pour chart, {mode,color,brightness,period_ms,value} pour led_ring.
// label/sound : pas de valeur de test pertinente.
function buildUpdatePayload(state) {
  const out = {};
  for (const [id, c] of Object.entries(state.components || {})) {
    const m = getMock(id, c.type);
    if (c.type === 'readout' || c.type === 'bar' || c.type === 'meter' || c.type === 'led') out[id] = m.value ?? 0;
    else if (c.type === 'ring') { out[id] = { pct: m.value ?? 0 }; if (c.countdown && m.reset_in_s != null) out[id].reset_in_s = m.reset_in_s; }
    else if (c.type === 'chart') { const h = m.hist || []; if (h.length) out[id] = h[h.length - 1]; }
    else if (c.type === 'led_ring') out[id] = { mode: c.mode || 'off', color: c.color || '#FFFFFF', brightness: c.brightness ?? 64, period_ms: c.period_ms ?? 1000, value: Number(m.value ?? 0) };
  }
  return out;
}

async function main() {
  installConsoleCapture();   // capture console.* vers le journal JS dès le boot (idempotent)
  await initI18n(loadSettings().lang);   // langue active avant tout rendu (toasts, vues)
  applyStaticI18n(document);             // traduit le chrome statique marqué (no-op tant que rien n'est marqué)
  document.title = t('title.app');
  document.documentElement.lang = currentLang();   // <html lang> suit la langue active (a11y, défaut HTML = fr)
  // Le schema partage vit dans ../schema (hors du dossier designer) : servir depuis le parent.
  let schema;
  try {
    const r = await fetch('../schema/layout.schema.json');
    if (!r.ok) throw new Error(`HTTP ${r.status} — servir depuis Dialboard/, pas designer/`);
    schema = await r.json();
  } catch (e) {
    showToast(t('toast.schema_error', { msg: e.message }), { kind: 'err', ms: 6000 });
    return;
  }
  const validate = createValidator(schema);
  // Autosave : restaure le dernier layout édité (localStorage) ou repart du défaut ; persiste à chaque modif.
  // Filet anti-perte : un reload accidentel ne perd plus le travail non exporté/poussé.
  const SAVE_KEY = 'rt-designer-layout';
  let saved;
  try { const s = localStorage.getItem(SAVE_KEY); if (s) saved = JSON.parse(s); } catch (e) {}
  if (saved) { stripPhysicalPlacements(saved); ensurePhysicals(saved); pruneOrphans(saved); }   // migration : physiques jamais placés + toujours présents + purge orphelins
  const model = createModel(saved);
  model.subscribe(() => { try { localStorage.setItem(SAVE_KEY, model.toJSON()); } catch (e) {} });

  // Réglages d'édition (persistés). settingsState est lu par le canvas (snap) et le tiroir.
  let settingsState = loadSettings();
  applyVisualSettings(settingsState);
  const getSettings = () => settingsState;
  const setSettings = (partial) => {
    settingsState = normalizeSettings({ ...settingsState, ...partial });
    saveSettings(settingsState);
    applyVisualSettings(settingsState);
    dconsole.refreshTabs();   // un réglage de journal peut masquer/montrer un onglet de console (closure : dconsole défini plus bas)
  };

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
    onLiveMove: p => inspector.setLivePlacement(p),   // MAJ live des champs Placement pendant le drag
    getGridSnap: () => ({ snap: settingsState.gridSnap, step: settingsState.gridStep })
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
      if (!base) { showToast(t('toast.device_url_q')); return false; }
      // withBusy renvoie le texte de succès (truthy) ou undefined (échec/ré-entrée) → booléen pour l'inspecteur.
      const r = await withBusy(visible ? t('toast.showing') : t('toast.hiding'), async () => {
        await pushValues(base, { [id]: { visible } });
        return visible ? t('toast.shown') : t('toast.hidden');
      });
      return r !== undefined;
    }
  });

  // Palette : glisser un type depuis la palette sur le canvas pour créer un composant
  // sur la page active, puis sélection du nouveau placement.
  createPalette($('board'), model, {
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
      if (ni >= 0) { canvas.selectPlacement(ni); logs.logActivity(t('activity.comp_pasted', { type: clipboard.compDef.type })); }
    },
    duplicate() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      let ni = -1;
      model.commit(s => { ni = duplicateComponent(s, canvas.getActivePage(), sel); });
      if (ni >= 0) { canvas.selectPlacement(ni); logs.logActivity(t('activity.comp_duplicated')); }
    },
    remove() {
      const sel = canvas.getSelected();
      if (sel == null) return;
      canvas.selectPlacement(null);
      model.commit(s => removePlacementAndOrphan(s, canvas.getActivePage(), sel));
      logs.logActivity(t('activity.comp_removed'));
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
  const onLoad = () => { model.commit(s => { stripPhysicalPlacements(s); ensurePhysicals(s); pruneOrphans(s); }); canvas.setPage(0); tree.render(); };
  bindFileIO(model, {
    exportBtn: $('export'), importBtn: $('import'), importInput: $('import-file'),
    onLoad,
  });

  // Mode desktop (Electron) : workflow fichier .dboard (layout + assets). Inactif en web (window.desktop absent).
  if (window.desktop) {
    let currentPath = null, dirty = false;
    const baseName = (p) => (p ? p.replace(/^.*[\\/]/, '') : t('desktop.untitled'));
    const refreshTitle = () => window.desktop.setTitle(baseName(currentPath) + (dirty ? ' •' : ''));
    refreshTitle();
    window.desktop.setMenuLabels({
      file: t('menu.file'), open: t('menu.open'), save: t('menu.save'), saveAs: t('menu.save_as'),
    });
    // Picker mDNS (preload CommonJS, sans accès à t()) : on lui pousse ses libellés traduits.
    window.desktop.setMdnsLabels?.({
      picker_title: t('mdns.picker_title'), rescan_title: t('mdns.rescan_title'),
      picker_placeholder: t('mdns.picker_placeholder'), device_default_name: t('mdns.device_default_name'),
    });
    model.subscribe(() => { dirty = true; refreshTitle(); });
    window.desktop.onMenu(async (action) => {
      try {
        if (action === 'open') {
          const r = await window.desktop.openBundle();
          if (!r) return;
          loadBundle(model, r.text);
          onLoad();
          currentPath = r.path; dirty = false; refreshTitle();
          logs.logActivity(t('activity.bundle_opened', { name: baseName(r.path) }));
        } else {                                   // 'save' | 'saveAs'
          const text = serializeBundle(model);
          const r = (action === 'save' && currentPath)
            ? await window.desktop.saveBundle(text, currentPath)
            : await window.desktop.saveBundleAs(text);
          if (!r) return;                          // dialogue annulé → ne pas marquer propre
          currentPath = r.path; dirty = false; refreshTitle();
          logs.logActivity(t('activity.bundle_saved', { name: baseName(r.path) }));
        }
      } catch (e) {
        showToast(t('toast.file_error', { msg: e.message }), { kind: 'err' });
      }
    });
  }

  // Panneau Sources (pull réseau) : édition des sources top-level. Indépendant du canvas/pages.
  createSources($('sources'), model);
  createSinks($('sinks'), model);
  const drawer = createDrawer($('drawer'), { toggleBtn: $('drawer-toggle'), onOpen: () => { settings.close(); sinksDrawer.close(); } });  // settings/sinksDrawer déclarés après — closure, pas de TDZ
  const sinksDrawer = createDrawer($('sinks-drawer'), { toggleBtn: $('sinks-toggle'), onOpen: () => { drawer.close(); settings.close(); } });
  const languages = await availableLanguages();
  const settings = createSettings($('settings-drawer'), {
    toggleBtn: $('settings-toggle'),
    onOpen: () => { drawer.close(); sinksDrawer.close(); },   // un seul tiroir ouvert à la fois
    getSettings, setSettings,
    languages,
    currentLang: currentLang(),
    onLanguageChange: (code) => { setSettings({ lang: code }); location.reload(); },
    onNewLayout: () => {                           // layout vierge (undoable : loadJSON snapshot)
      model.loadJSON(JSON.stringify(DEFAULT_LAYOUT));
      canvas.setPage(0); tree.render(); setSelection(null);
      logs.logActivity(t('activity.new_layout'));
    },
  });

  // Pull on-demand pour l'onglet Device : /context (blackboard) + /status (télémétrie + uptime pour l'âge).
  const pullDeviceContext = async () => {
    const base = $('base').value;
    const [vars, status] = await Promise.all([getContext(base), getStatus(base)]);
    return { vars, sources: status.sources || [], sinks: status.sinks || [], uptime_s: status.uptime_s };
  };
  const dconsole = createConsole($('console'), model, { validate, logs, getSettings, pullDeviceContext });
  createStatusbar($('statusbar'), model, { selection, validate, onValidClick: () => dconsole.open('problems') });

  const syncUndo = () => { $('undo').disabled = !model.canUndo(); $('redo').disabled = !model.canRedo(); };
  model.subscribe(syncUndo); syncUndo();
  // Annuler/Rétablir journalisés seulement s'ils ont un effet (pile non vide). Partagés boutons + raccourcis.
  const doUndo = () => { if (model.canUndo()) { model.undo(); logs.logActivity(t('activity.undo')); } };
  const doRedo = () => { if (model.canRedo()) { model.redo(); logs.logActivity(t('activity.redo')); } };
  $('undo').onclick = doUndo;
  $('redo').onclick = doRedo;

  // Raccourcis clavier globaux : Cmd/Ctrl+Z = annuler, +Shift+Z = rétablir, Échap = désélectionner,
  // Cmd/Ctrl+D = dupliquer, +C = copier, +V = coller (copies indépendantes ; coller sur la page
  // active = réutilisation cross-page), Suppr = retirer de la page active. Inactifs dans un champ.
  document.addEventListener('keydown', e => {
    const action = resolveShortcut({
      key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
      editable: isEditableTarget(e.target)
    });
    if (!action) return;
    if (action === 'undo') { e.preventDefault(); doUndo(); return; }
    if (action === 'redo') { e.preventDefault(); doRedo(); return; }
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

  // Échelle d'affichage du canvas = fit (board entier visible dans la colonne). Le board (écran + zones)
  // est scalé d'un bloc → les zones épousent l'écran à toute échelle ; le rect live du #stage (÷360) reste
  // la source du facteur pour le DnD et les interactions (palette/canvas).
  const board = $('board'), boardFit = $('board-fit'), canvasCol = $('canvas-col'), consoleEl = $('console');
  const applyScale = () => {
    // Réserve = titre + indice + carousel (~170) + hauteur RÉELLE de la console (logée dans la colonne,
    // repliée ~30 px / dépliée jusqu'à 30vh) → le board occupe le reste, au-dessus de la console.
    const reserve = 170 + (consoleEl ? consoleEl.offsetHeight : 0);
    const availW = Math.max(120, canvasCol.clientWidth - 24);
    const availH = Math.max(120, canvasCol.clientHeight - reserve);
    const fit = Math.min(availW / BOARD_W, availH / BOARD_H, 1.5);
    const s = Math.max(0.2, fit);
    board.style.transform = `scale(${s})`;
    boardFit.style.width = (BOARD_W * s) + 'px';
    boardFit.style.height = (BOARD_H * s) + 'px';
  };
  const ro = new ResizeObserver(applyScale);
  ro.observe(canvasCol);
  if (consoleEl) ro.observe(consoleEl);   // (dé)pliage de la console → re-fit du board (même observer)
  applyScale();                            // appel sync initial (le 1er callback de l'observer est asynchrone)

  // URL du device : pré-remplie pour éviter le piège « URL device ? » dès la 1re action. Quand le designer
  // est servi PAR le device (embarqué : http://<ip>/designer/), location.origin EST le device. En dev local
  // (localhost/file), on restaure plutôt la dernière URL saisie (localStorage) ; sinon le placeholder reste.
  const BASE_KEY = 'rt-designer-base';
  const baseInput = $('base');
  let savedBase = ''; try { savedBase = localStorage.getItem(BASE_KEY) || ''; } catch (e) {}
  // L'origine n'est le device que si on est servi PAR lui : http(s) et pas localhost/127. En desktop
  // (app://) ou en dev local, champ vide plutôt que pré-remplir une origine qui n'est pas un device.
  const originIsDevice = /^https?:$/.test(location.protocol) && !/\/\/(localhost|127\.0\.0\.1)\b/.test(location.origin);
  baseInput.value = savedBase || (originIsDevice ? location.origin : '');
  baseInput.addEventListener('change', () => { try { localStorage.setItem(BASE_KEY, baseInput.value); } catch (e) {} probeConnection(); });

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
    if (busy) { showToast(t('toast.device_busy')); return undefined; }
    const toastHandle = makeToast(progressMsg);
    setDeviceBusy(true);
    try {
      const okMsg = await fn();
      toastHandle.morph(typeof okMsg === 'string' ? okMsg : t('toast.done'), 'ok');
      logs.logActivity(typeof okMsg === 'string' ? okMsg : t('activity.device_op'));
      markReachable();                                       // op réussie → device joignable
      return okMsg;
    } catch (e) {
      const hint = e instanceof TypeError ? t('toast.network_hint') : '';
      toastHandle.morph(t('toast.failure', { msg: e.message }) + hint, 'err');
      logs.logActivity(t('activity.device_failure', { msg: e.message }));
      if (e instanceof TypeError) markUnreachable(e.message);   // fetch rejeté = device injoignable
      else markReachable();                                     // HTTP/validation : le device a répondu
      return undefined;
    } finally {
      setDeviceBusy(false);
    }
  }
  withConfirm($('load'), () => {
    const base = $('base').value;
    withBusy(t('toast.loading'), async () => {
      const lay = await loadLayout(base);
      stripPhysicalPlacements(lay); ensurePhysicals(lay); pruneOrphans(lay);   // migration avant chargement dans le modèle
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
      return t('toast.loaded');
    });
  }, { label: t('confirm.load'), guard: () => {
    if (!$('base').value) { showToast(t('toast.device_url_q')); return false; }
    return true;
  } });
  withConfirm($('push'), () => {
    const base = $('base').value;
    withBusy(t('toast.sending'), async () => {
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
      return t('toast.pushed');
    });
  }, { label: t('confirm.push'), guard: () => {
    if (!$('base').value) { showToast(t('toast.device_url_q')); return false; }
    if (!validate(model.state).valid) { showToast(t('toast.layout_invalid')); return false; }
    return true;
  } });
  // --- Boucle device : santé (/status), valeurs de test (/update), capture + navigation (/page + /screenshot) ---
  // Pastille device (toolbar) : état de connexion permanent (modèle A). Paresseuse — « ○ non vérifié »
  // au boot, renseignée à la 1re requête Statut (succès → ● ip + détail en infobulle ; échec → ○ injoignable).
  const devPill = $('dev-pill');
  const setDevicePill = (kind, label, tooltip = '') => {
    devPill.className = 'dev-pill' + (kind ? ' ' + kind : '');
    devPill.textContent = label;
    devPill.title = tooltip;
  };
  // Joignabilité dérivée de TOUTE op device (via withBusy), pas seulement du bouton Statut. markReachable
  // n'écrase PAS un détail riche déjà posé par le Statut (label « ● ip » + infobulle page/uptime/sources).
  const devHost = () => { const b = $('base').value; try { return new URL(b).host || b; } catch (e) { return b || 'device'; } };
  // Déclarations de fonction (hoisted), référencées plus haut → pas de TDZ : withBusy pour markReachable/
  // markUnreachable, le listener « change » (URL device) pour probeConnection.
  function markReachable() { if (!devPill.classList.contains('ok')) setDevicePill('ok', '● ' + devHost(), t('pill.reachable.tip')); }
  function markUnreachable(msg) { setDevicePill('err', t('pill.unreachable'), msg); }
  // probeConnection : check de connexion silencieux (hors withBusy → ni toast « Statut… » ni verrou busy).
  // Appelé au 1er lancement ET à chaque saisie d'URL (change). Embarqué : location.origin ; sinon URL saisie.
  async function probeConnection() {
    const base = baseInput.value;
    if (!base) return;
    try { const f = formatDeviceStatus(await getStatus(base)); setDevicePill('ok', f.label, f.tooltip); }
    catch (e) { if (e instanceof TypeError) markUnreachable(e.message); else markReachable(); }
  }
  probeConnection();   // 1er lancement
  $('statusbtn').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast(t('toast.device_url_q'));
    withBusy(t('toast.status'), async () => {
      const f = formatDeviceStatus(await getStatus(base));
      setDevicePill('ok', f.label, f.tooltip);   // détail riche ; markReachable ne l'écrase pas, withBusy gère l'échec
      return t('toast.status_ok');
    });
  };
  $('values').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast(t('toast.device_url_q'));
    const payload = buildUpdatePayload(model.state);
    if (!Object.keys(payload).length) return void showToast(t('toast.no_test_values'));
    withBusy(t('toast.values'), async () => {
      const r = await pushValues(base, payload);
      return t('toast.values_pushed', { n: r.updated ?? '?' });
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
    try { const s = await getStatus($('base').value); $('shot-page').textContent = t('shot.page', { cur: (+s.page) + 1, total: s.pages }); }
    catch (e) { $('shot-page').textContent = ''; }
  };
  $('capture').onclick = () => {
    const base = $('base').value;
    if (!base) return void showToast(t('toast.device_url_q'));
    withBusy(t('toast.capturing'), async () => {
      await doCapture(); await refreshShotPage(); $('shot-overlay').hidden = false;
      return t('toast.captured');
    });
  };
  const navAndCapture = (dir) => {
    const base = $('base').value;
    if (!base) return;
    withBusy(t('toast.navigating'), async () => {
      await setDevicePage(base, { dir });
      await new Promise(r => setTimeout(r, 350));   // laisse le device basculer + sync avant la capture
      await doCapture(); await refreshShotPage();
      return t('toast.captured');
    });
  };
  $('shot-prev').onclick = () => navAndCapture('prev');
  $('shot-next').onclick = () => navAndCapture('next');
  $('shot-close').onclick = () => { $('shot-overlay').hidden = true; };
}

main();

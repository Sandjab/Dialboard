// Inspecteur : édite le composant + le placement sélectionnés. Pilote les champs par des tables de
// descripteurs (DRY). Chaque édition committée = UN commit (sur 'change', pas par frappe → pas de
// flood undo). Le signalement ASCII est live (sur 'input'). S'abonne au modèle pour se rafraîchir.
import { setComponentProp, setPlacementProp, setThresholds, removePlacementAndOrphan, setPageBackground, setPageBackgroundImage } from './mutations.js';
import { imageFileToBg, previewUrl } from './bg-image.js';
import { imageFileToAsset, previewUrl as imagePreviewUrl } from './image-asset.js';
import { decodeGif, decodeImages, framesToAsset, previewUrls as aimgPreviewUrls } from './image-anim-asset.js';
import { COMPONENTS } from './registry.js';
import { ANCHORS, ANCHORS_OUT } from './geometry.js';
import { getMock, setMock } from './mocks.js';

const FONTS = [14, 20, 28, 36, 48];
const nonAscii = v => /[^\x00-\x7F]/.test(v ?? '');

// Construit un <input>/<select> selon kind. onChange reçoit la valeur typée. Les éditeurs textuels
// committent sur 'change' (pas 'input') pour ne pas inonder l'undo.
function makeInput(kind, value, onChange) {
  let el;
  if (kind === 'bool') {
    el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!value;
    el.addEventListener('change', () => onChange(el.checked));
  } else if (kind === 'color') {
    el = document.createElement('input'); el.type = 'color'; el.value = value || '#FFFFFF';
    el.addEventListener('change', () => onChange(el.value.toUpperCase()));
  } else if (kind === 'font') {
    el = document.createElement('select');
    for (const f of FONTS) { const o = document.createElement('option'); o.value = String(f); o.textContent = f + ' px'; if (f === (value ?? 20)) o.selected = true; el.appendChild(o); }
    el.addEventListener('change', () => onChange(Number(el.value)));
  } else if (kind === 'anchor') {
    el = document.createElement('select');
    for (const a of ANCHORS) { const o = document.createElement('option'); o.value = a; o.textContent = a; if (a === (value || 'CENTER')) o.selected = true; el.appendChild(o); }
    el.addEventListener('change', () => onChange(el.value));
  } else if (kind === 'anchorOut') {
    el = document.createElement('select');
    for (const a of ANCHORS_OUT) { const o = document.createElement('option'); o.value = a; o.textContent = a; if (a === (value || 'TOP_MID')) o.selected = true; el.appendChild(o); }
    el.addEventListener('change', () => onChange(el.value));
  } else if (kind === 'num') {
    el = document.createElement('input'); el.type = 'number'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
  } else { // text / asciitext
    el = document.createElement('input'); el.type = 'text'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value));
  }
  return el;
}

// Ligne libellé + champ (+ avertissement ASCII live pour les champs asciitext).
function fieldRow(label, input, { ascii } = {}) {
  const row = document.createElement('label');
  row.className = 'insp-row';
  const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
  row.appendChild(span); row.appendChild(input);
  if (ascii) {
    const warn = document.createElement('span'); warn.className = 'insp-warn'; warn.textContent = '⚠ ASCII';
    warn.style.display = nonAscii(input.value) ? '' : 'none';
    input.addEventListener('input', () => { warn.style.display = nonAscii(input.value) ? '' : 'none'; });
    row.appendChild(warn);
  }
  return row;
}

export function createInspector(root, model, { rerenderCanvas, clearSelection, getActivePage = () => 0 } = {}) {
  let sel = null; // { placeIndex, ref } ou null
  let placementInputs = {}; // { anchor, dx, dy } → <input>/<select> de la rubrique Placement, pour la MAJ live au drag

  const comp = () => sel && model.state.components[sel.ref];
  const place = () => sel && model.state.pages?.[getActivePage()]?.place?.[sel.placeIndex];

  function select(s) { sel = s; render(); }

  // Sous-titre de section.
  function sub(body, text) { const h = document.createElement('div'); h.className = 'insp-sub'; h.textContent = text; body.appendChild(h); }
  function note(body, text) { const n = document.createElement('div'); n.className = 'insp-note'; n.textContent = text; body.appendChild(n); }

  // Rien de sélectionné : l'inspecteur édite le layout (titre/fond — jusqu'ici accessibles seulement
  // via le JSON brut) et résume la page active, au lieu de laisser la colonne droite vide.
  function renderPagePanel(body) {
    const s = model.state;
    const head = document.createElement('div'); head.className = 'insp-head'; head.textContent = 'Layout';
    body.appendChild(head);
    const title = makeInput('text', s.title ?? '', v => model.commit(st => { st.title = v; }));
    body.appendChild(fieldRow('Titre', title, { ascii: true }));            // texte affiché par le device = ASCII
    const bg = makeInput('color', s.background || '#000000', v => model.commit(st => { st.background = v; }));
    body.appendChild(fieldRow('Fond', bg));
    sub(body, 'Page active');
    const pi = getActivePage();
    const pg = s.pages?.[pi];
    // Fond de la page : override optionnel. (hérité) si absent (= fond global) ; ↺ pour réhériter sinon.
    if (pg) {
      const pbg = makeInput('color', pg.background || s.background || '#000000',
        v => model.commit(st => setPageBackground(st, pi, v)));
      const row = fieldRow('Fond page', pbg);
      if (pg.background == null) {
        const hint = document.createElement('span'); hint.className = 'insp-bg-hint'; hint.textContent = '(hérité)';
        row.appendChild(hint);
      } else {
        const reset = document.createElement('button');
        reset.type = 'button'; reset.className = 'insp-bg-reset'; reset.textContent = '↺';
        reset.title = 'Hériter du fond global';
        reset.addEventListener('click', () => model.commit(st => setPageBackground(st, pi, null)));
        row.appendChild(reset);
      }
      body.appendChild(row);
      // Image de fond de la page : override optionnel, prime sur la couleur. Conversion + upload
      // au navigateur (cf. bg-image.js) ; la cle (hash) est posee dans le layout, les octets sont
      // pousses au device au « Pousser » (app.js).
      const imgRow = document.createElement('div'); imgRow.className = 'insp-row';
      const imgLabel = document.createElement('span'); imgLabel.className = 'insp-label';
      imgLabel.textContent = 'Image de fond';
      imgRow.appendChild(imgLabel);
      const file = document.createElement('input');
      file.type = 'file'; file.accept = 'image/*'; file.className = 'insp-bg-file';
      file.addEventListener('change', async () => {
        const f = file.files?.[0]; if (!f) return;
        try {
          const { key } = await imageFileToBg(f);
          model.commit(st => setPageBackgroundImage(st, pi, key));
        } catch (e) { console.error('bg image:', e); }
        file.value = '';
      });
      imgRow.appendChild(file);
      if (pg.background_image) {
        const thumb = document.createElement('img');
        thumb.className = 'insp-bg-thumb';
        const u = previewUrl(pg.background_image);
        if (u) thumb.src = u; else thumb.alt = '(recharger depuis le device)';
        imgRow.appendChild(thumb);
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'insp-bg-reset'; del.textContent = '↺';
        del.title = "Retirer l'image";
        del.addEventListener('click', () => model.commit(st => setPageBackgroundImage(st, pi, null)));
        imgRow.appendChild(del);
      }
      body.appendChild(imgRow);
    }
    const onPage = pg?.place?.length ?? 0;
    const total = Object.keys(s.components || {}).length;
    note(body, `${pg?.name || `Page ${pi + 1}`} — ${onPage} placé(s) · ${total} composant(s) au total`);
    const tip = document.createElement('p'); tip.className = 'todo';
    tip.textContent = 'Sélectionne un widget sur le canvas pour l’éditer.';
    body.appendChild(tip);
  }

  function renderExtras(body, c) {
    const p = place();
    // --- Géométrie du placement ---
    const gf = COMPONENTS[c.type].placeFields;
    if (gf.length) {
      sub(body, 'Placement');
      if (c.type === 'ring') note(body, 'Anneau centré : ancrage/dx/dy ignorés par le firmware.');
      for (const [key, label, kind] of gf) {
        const input = makeInput(kind, p[key], v => model.commit(s => setPlacementProp(s, getActivePage(), sel.placeIndex, key, v)));
        placementInputs[key] = input;   // réf. pour setLivePlacement (drag)
        body.appendChild(fieldRow(label, input));
      }
    }

    // --- Seuils ring/meter (liste éditable de [limite, #couleur]) ---
    // ring : couleur si valeur < limite ; meter : zone d'arc (limite précédente → limite).
    if (c.type === 'ring' || c.type === 'meter') {
      sub(body, c.type === 'meter' ? 'Zones (couleur de la limite précédente à la limite)'
                                   : 'Seuils (couleur si valeur < limite)');
      const ths = (c.thresholds || []).map(t => [t[0], t[1]]); // copie locale éditable
      const commitThs = () => model.commit(s => setThresholds(s, sel.ref, ths.filter(t => t[1])));
      ths.forEach((t, idx) => {
        const row = document.createElement('div'); row.className = 'insp-row';
        const lim = makeInput('num', t[0], v => { ths[idx][0] = v === '' ? 0 : v; commitThs(); });
        const col = makeInput('color', t[1], v => { ths[idx][1] = v; commitThs(); });
        const rm = document.createElement('button'); rm.className = 'insp-th-rm'; rm.textContent = '×';
        rm.addEventListener('click', () => { ths.splice(idx, 1); commitThs(); });
        row.appendChild(lim); row.appendChild(col); row.appendChild(rm);
        body.appendChild(row);
      });
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = '+ seuil';
      add.addEventListener('click', () => { ths.push([0, '#FF0000']); commitThs(); });
      body.appendChild(add);
    }

    // --- Valeur d'aperçu (mock) : hors layout, re-rend le canvas sans toucher au modèle/undo ---
    const mf = COMPONENTS[c.type].mockFields;
    if (mf.length) {
      sub(body, 'Aperçu (mock, non poussé au device)');
      const m = getMock(sel.ref, c.type);
      for (const [key, label] of mf) {
        const input = makeInput('num', m[key], v => {
          setMock(sel.ref, { [key]: v === '' ? 0 : v });
          rerenderCanvas && rerenderCanvas();
        });
        body.appendChild(fieldRow(label, input));
      }
    }
  }

  // Champ « Image » d'un composant image : file picker + miniature + reset. Convertit au navigateur a
  // la taille COURANTE du composant (c.w×c.h) et committe la cle dans `src` ; la source est memorisee
  // (image-asset) pour permettre le re-render au resize (cf. canvas.addImageHandles).
  function imageField(label, c) {
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
    row.appendChild(span);
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.className = 'insp-bg-file';
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; if (!f) return;
      try {
        const { key } = await imageFileToAsset(f, sel.ref, c.w || 120, c.h || 120);
        model.commit(st => setComponentProp(st, sel.ref, 'src', key));
      } catch (e) { console.error('image:', e); }
      file.value = '';
    });
    row.appendChild(file);
    if (c.src) {
      const thumb = document.createElement('img'); thumb.className = 'insp-bg-thumb';
      const u = imagePreviewUrl(c.src);
      if (u) thumb.src = u; else thumb.alt = '(recharger depuis le device)';
      row.appendChild(thumb);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'insp-bg-reset'; del.textContent = '↺';
      del.title = "Retirer l'image";
      del.addEventListener('click', () => model.commit(st => setComponentProp(st, sel.ref, 'src', null)));
      row.appendChild(del);
    }
    return row;
  }

  // Champ « Animation » d'un composant image_anim : import GIF/serie d'images -> pack, bande de
  // vignettes (choix de la frame de repos), bouton Apercu (anime le canvas). Convertit au navigateur
  // a la taille COURANTE du composant (c.w×c.h). Commit en bloc : src + frames + w/h (+ period si GIF).
  let _aimgPreviewTimer = null;
  function imageAnimField(label, c) {
    const wrap = document.createElement('div'); wrap.className = 'insp-aimg';
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
    row.appendChild(span);
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.multiple = true; file.className = 'insp-bg-file';
    file.addEventListener('change', async () => {
      const fs = file.files; if (!fs || !fs.length) return;
      try {
        const w = c.w || 120, h = c.h || 120;
        const isGif = fs.length === 1 && /gif$/i.test(fs[0].type || fs[0].name);
        const { drawables, periodMs } = isGif ? await decodeGif(fs[0]) : await decodeImages([...fs]);
        const { key, frames } = framesToAsset(drawables, w, h);
        model.commit(st => {
          setComponentProp(st, sel.ref, 'src', key);
          setComponentProp(st, sel.ref, 'frames', frames);
          setComponentProp(st, sel.ref, 'w', w);
          setComponentProp(st, sel.ref, 'h', h);
          if (isGif) setComponentProp(st, sel.ref, 'period', periodMs);
          if ((c.rest_frame || 0) >= frames) setComponentProp(st, sel.ref, 'rest_frame', 0);
        });
      } catch (e) { console.error('image_anim:', e); }
      file.value = '';
    });
    row.appendChild(file);
    if (c.src) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'insp-bg-reset'; del.textContent = '↺';
      del.title = "Retirer l'animation";
      del.addEventListener('click', () => model.commit(st => {
        setComponentProp(st, sel.ref, 'src', null);
        setComponentProp(st, sel.ref, 'frames', null);
      }));
      row.appendChild(del);
    }
    wrap.appendChild(row);
    const urls = c.src ? aimgPreviewUrls(c.src) : [];
    if (urls.length) {
      const strip = document.createElement('div'); strip.className = 'insp-aimg-strip';
      urls.forEach((u, i) => {
        const t = document.createElement('img'); t.className = 'insp-aimg-frame'; t.src = u;
        if (i === (c.rest_frame || 0)) t.classList.add('is-rest');
        t.title = 'Frame ' + i + ' — clic = frame de repos';
        t.addEventListener('click', () => model.commit(st => setComponentProp(st, sel.ref, 'rest_frame', i)));
        strip.appendChild(t);
      });
      wrap.appendChild(strip);
      const play = document.createElement('button');
      play.type = 'button'; play.className = 'insp-aimg-play'; play.textContent = '▶ Aperçu';
      play.addEventListener('click', () => {
        if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; play.textContent = '▶ Aperçu'; return; }
        const node = document.querySelector(`#stage [data-ref="${sel.ref}"]`);
        const imgEl = node ? node.querySelector('.w-image-img') : null;
        if (!imgEl) return;
        let f = 0;
        play.textContent = '⏸ Aperçu';
        _aimgPreviewTimer = setInterval(() => {
          f = (f + 1) % urls.length;
          imgEl.src = urls[f];
        }, Math.max(20, c.period || 100));
      });
      wrap.appendChild(play);
    }
    return wrap;
  }

  function render() {
    // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
    if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'apercu avant tout rebuild de l'inspecteur
    root.querySelectorAll('.insp-body').forEach(n => n.remove());
    placementInputs = {};   // les anciens champs viennent d'être retirés
    const c = comp();
    const p = place();
    const body = document.createElement('div');
    body.className = 'insp-body';
    if (!c || !p) {                               // sélection absente ou devenue obsolète (page changée, undo…)
      renderPagePanel(body); root.appendChild(body); return;
    }
    const head = document.createElement('div'); head.className = 'insp-head';
    head.textContent = `${c.type} · ${sel.ref}`;
    body.appendChild(head);

    const rows = {};
    for (const [key, label, kind, enableWhen] of COMPONENTS[c.type].compFields) {
      if (kind === 'image') { body.appendChild(imageField(label, c)); continue; }   // picker bespoke
      if (kind === 'image_anim') { body.appendChild(imageAnimField(label, c)); continue; }   // editeur bespoke
      const input = makeInput(kind, c[key], v => model.commit(s => setComponentProp(s, sel.ref, key, v)));
      const row = fieldRow(label, input, { ascii: kind === 'asciitext' });
      rows[key] = { input, row, enableWhen };
      body.appendChild(row);
    }
    // Grise les champs non pertinents dans l'état courant (ex : couleur/police du centre si center_pct off).
    // En direct, sans rebuild : le garde-focus de render() bloquerait une reconstruction juste après le clic.
    const syncEnabled = () => {
      const cc = comp(); if (!cc) return;
      for (const { input, row, enableWhen } of Object.values(rows)) {
        if (!enableWhen) continue;
        const ok = enableWhen(cc);
        input.disabled = !ok;
        row.classList.toggle('disabled', !ok);
      }
    };
    syncEnabled();
    body.addEventListener('change', syncEnabled); // un toggle (ex: center_pct) re-évalue les dépendants

    renderExtras(body, c); // Task 6

    const del = document.createElement('button'); del.className = 'insp-del'; del.textContent = 'Supprimer de la page';
    del.addEventListener('click', () => {
      const i = sel.placeIndex;
      sel = null;
      clearSelection && clearSelection();                 // désélectionne AVANT le commit (évite le flash, note C1-c)
      model.commit(s => removePlacementAndOrphan(s, getActivePage(), i));
    });
    body.appendChild(del);
    root.appendChild(body);
  }

  // Pendant un drag de widget sur le canvas, reflète les valeurs d'ancrage live dans les champs
  // Placement, sans commit (le commit unique a lieu au drop — cf. canvas.js). Purement visuel ;
  // no-op si les champs n'existent pas (composant non sélectionné / centré / physique).
  function setLivePlacement({ anchor, dx, dy } = {}) {
    if (placementInputs.anchor && anchor != null) placementInputs.anchor.value = anchor;
    if (placementInputs.dx && dx != null) placementInputs.dx.value = dx;
    if (placementInputs.dy && dy != null) placementInputs.dy.value = dy;
  }

  model.subscribe(render);
  render();
  return { select, setLivePlacement };
}

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
// Selects à options fixes (value firmware → libellé FR). Étend le motif anchor/anchorOut.
const SELECTS = {
  barmode: [['normal', 'Normal'], ['symmetrical', 'Symétrique']],
  orient:  [['horizontal', 'Horizontal'], ['vertical', 'Vertical']],
  arcmode: [['normal', 'Normal'], ['symmetrical', 'Symétrique'], ['reverse', 'Inversé']],
};
const nonAscii = v => /[^\x00-\x7F]/.test(v ?? '');

const deviceHidden = new Set();   // refs poussées cachées sur le device (état de bascule du bouton)

// Œil de visibilité : icône SVG en data-URI (img), couleur baked-in (clair = visible, rouge = caché).
const EYE_OPEN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23E5E7EB' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E";
const EYE_OFF_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cline x1='3' y1='3' x2='21' y2='21'/%3E%3C/svg%3E";

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
  } else if (SELECTS[kind]) {
    el = document.createElement('select');
    const opts = SELECTS[kind];
    for (const [val, txt] of opts) { const o = document.createElement('option'); o.value = val; o.textContent = txt; if (val === (value ?? opts[0][0])) o.selected = true; el.appendChild(o); }
    el.addEventListener('change', () => onChange(el.value));
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

export function createInspector(root, model, { rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible } = {}) {
  let sel = null; // { placeIndex, ref } ou null
  let placementInputs = {}; // { anchor, dx, dy } → <input>/<select> de la rubrique Placement, pour la MAJ live au drag

  const comp = () => sel && model.state.components[sel.ref];
  const place = () => sel && model.state.pages?.[getActivePage()]?.place?.[sel.placeIndex];

  function select(s) {
    // Changement de sélection : si un champ de l'inspecteur a encore le focus, le blur AVANT de
    // changer `sel`. Sinon (F1) deux pièges quand on clique un autre widget déplaçable (son
    // pointerdown fait preventDefault → le focus ne part pas) : (a) le garde-focus de render()
    // bloque la reconstruction → l'inspecteur reste figé sur l'ANCIEN composant alors que le canvas
    // a déjà sélectionné le nouveau ; (b) une édition en attente (change non encore émis) se
    // committerait sur le NOUVEAU composant (clé étrangère → layout invalide). Blur ici committe
    // l'édition en attente sur l'ANCIEN composant (sel encore inchangé) puis lève le garde.
    const changed = sel?.ref !== s?.ref || sel?.placeIndex !== s?.placeIndex;
    if (changed && root.contains(document.activeElement) && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    sel = s;
    render();
  }

  // Un champ de l'inspecteur perd le focus :
  //  - num   (F2) : fin de session d'édition → casse la coalescence d'undo (les flèches/spinner suivants
  //                 repartent sur une nouvelle entrée d'undo).
  //  - color (F3) : un aperçu live non committé (picker annulé après avoir bougé le curseur → pas de
  //                 'change') resterait « collé » au canvas ; on restaure l'état réel du modèle.
  root.addEventListener('focusout', e => {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    if (t.type === 'number') model.breakCoalesce();
    else if (t.type === 'color') { clearPreview?.(); rerenderCanvas?.(); }
  });

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
        const opts = kind === 'num' ? { coalesce: 'num' } : undefined;   // F2 : flèches/spinner d'un champ num = 1 entrée d'undo
        const input = makeInput(kind, p[key], v => model.commit(s => setPlacementProp(s, getActivePage(), sel.placeIndex, key, v), opts));
        placementInputs[key] = input;   // réf. pour setLivePlacement (drag)
        body.appendChild(fieldRow(label, input));
      }
    }

    // --- Seuils ring/meter (liste éditable de [limite, #couleur]) ---
    // ring : couleur si valeur < limite ; meter : zone d'arc (limite précédente → limite).
    if (c.type === 'ring' || c.type === 'meter' || c.type === 'bar') {
      sub(body, c.type === 'meter' ? 'Zones (couleur de la limite précédente à la limite)'
                                   : 'Seuils (couleur si valeur < limite)');
      const ref = sel.ref;   // figée au rendu (cf. compField : 'change' tardif du picker couleur)
      const ths = (c.thresholds || []).map(t => [t[0], t[1]]); // copie locale éditable
      const commitThs = (opts) => model.commit(s => setThresholds(s, ref, ths.filter(t => t[1])), opts);
      ths.forEach((t, idx) => {
        const row = document.createElement('div'); row.className = 'insp-row';
        const lim = makeInput('num', t[0], v => { ths[idx][0] = v === '' ? 0 : v; commitThs({ coalesce: 'num' }); });   // F2
        const col = makeInput('color', t[1], v => { clearPreview?.(); ths[idx][1] = v; commitThs(); });
        // Aperçu live de la couleur du seuil : override du tableau thresholds complet (canvas seul, hors modèle).
        col.addEventListener('input', () => previewProp?.(ref, {
          thresholds: ths.map((tt, i) => i === idx ? [tt[0], col.value.toUpperCase()] : [tt[0], tt[1]]).filter(tt => tt[1])
        }));
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
    const title = document.createElement('span'); title.textContent = `${c.type} · ${sel.ref}`;
    head.appendChild(title);
    if (!COMPONENTS[c.type].physical) {                 // led_ring/sound : pas de visuel à cacher
      const visible = c.visible !== false;
      const eye = document.createElement('button');
      eye.className = 'insp-eye';
      eye.title = visible ? 'Visible — cliquer pour cacher' : 'Caché — cliquer pour afficher';
      const icon = document.createElement('img');
      icon.src = visible ? EYE_OPEN_URI : EYE_OFF_URI;
      icon.width = 15; icon.height = 15; icon.alt = visible ? 'visible' : 'caché';
      eye.appendChild(icon);
      const ref = sel.ref;                              // figée au rendu (cf. invariant inspecteur/canvas)
      eye.addEventListener('click', () => {
        const next = !visible;                          // nouvel état après bascule (visible = état au rendu)
        eye.blur();                                     // libère le focus -> render() peut reconstruire (garde-focus)
        model.commit(s => setComponentProp(s, ref, 'visible', next));
      });
      head.appendChild(eye);
    }
    body.appendChild(head);

    const rows = {};
    for (const [key, label, kind, enableWhen] of COMPONENTS[c.type].compFields) {
      if (kind === 'image') { body.appendChild(imageField(label, c)); continue; }   // picker bespoke
      if (kind === 'image_anim') { body.appendChild(imageAnimField(label, c)); continue; }   // editeur bespoke
      // Color picker : aperçu live sur 'input' (canvas seul, hors modèle → pas de flood undo) ; commit
      // unique sur 'change' (makeInput), précédé d'un clearPreview pour que le commit re-rende l'état réel.
      // ref figée au rendu : le color picker émet son 'change' en DIFFÉRÉ (après qu'un clic ailleurs a
      // déjà déplacé `sel`) ; sans figer, le commit atterrirait sur la sélection courante (mauvais
      // composant). On committe donc toujours sur le composant qu'on éditait. (cf. bug picker couleur)
      const ref = sel.ref;
      const commit = v => { if (kind === 'color') clearPreview?.(); model.commit(s => setComponentProp(s, ref, key, v), kind === 'num' ? { coalesce: 'num' } : undefined); };   // F2 : coalesce num
      const input = makeInput(kind, c[key], commit);
      if (kind === 'color') input.addEventListener('input', () => previewProp?.(ref, { [key]: input.value.toUpperCase() }));
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

    if (!COMPONENTS[c.type].physical && pushVisible) {
      const ref = sel.ref;
      const dev = document.createElement('button');
      dev.className = 'insp-devvis';
      dev.textContent = deviceHidden.has(ref) ? 'Afficher sur le device' : 'Cacher sur le device';
      dev.addEventListener('click', async () => {
        const nextVisible = deviceHidden.has(ref);      // si caché -> on affiche ; sinon on cache
        const ok = await pushVisible(ref, nextVisible);
        if (ok) {
          if (nextVisible) deviceHidden.delete(ref); else deviceHidden.add(ref);
          dev.textContent = deviceHidden.has(ref) ? 'Afficher sur le device' : 'Cacher sur le device';
        }
      });
      body.appendChild(dev);
    }

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

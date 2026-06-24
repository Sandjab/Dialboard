// Inspecteur : édite le composant + le placement sélectionnés. Pilote les champs par des tables de
// descripteurs (DRY). Chaque édition committée = UN commit (sur 'change', pas par frappe → pas de
// flood undo). Le signalement ASCII est live (sur 'input'). S'abonne au modèle pour se rafraîchir.
import { setComponentProp, setPlacementProp, setBarOrientation, setThresholds, setIconStates, removePlacementAndOrphan, setPageBackground, setPageBackgroundImage, setNavWrap, renamePage, pageNameTaken } from './mutations.js';
import { showToast } from './toast.js';
import { imageFileToBg, previewUrl } from './bg-image.js';
import { imageFileToAsset, previewUrl as imagePreviewUrl } from './image-asset.js';
import { decodeGif, decodeImages, framesToAsset, previewUrls as aimgPreviewUrls } from './image-anim-asset.js';
import { COMPONENTS } from './registry.js';
import { ICON_SVG } from './render.js';
import { ANCHORS, ANCHORS_OUT } from './geometry.js';
import { getMock, setMock } from './mocks.js';
import { numDragValue } from './numdrag.js';

const FONTS = [14, 20, 28, 36, 48];
// Selects à options fixes (value firmware → libellé FR). Étend le motif anchor/anchorOut.
const SELECTS = {
  barmode: [['normal', 'Normal'], ['symmetrical', 'Symétrique']],
  orient:  [['horizontal', 'Horizontal'], ['vertical', 'Vertical']],
  arcmode: [['normal', 'Normal'], ['symmetrical', 'Symétrique'], ['reverse', 'Inversé']],
  dash:    [['solid', 'Plein'], ['dashed', 'Tirets'], ['dotted', 'Pointillé']],
  symbol:  Object.keys(ICON_SVG).map(n => [n, n]),
};
const nonAscii = v => /[^\x00-\x7F]/.test(v ?? '');

const deviceHidden = new Set();   // refs poussées cachées sur le device (état de bascule du bouton)

// Œil de visibilité : icône SVG en data-URI (img), couleur baked-in (clair = visible, rouge = caché).
const EYE_OPEN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23E5E7EB' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E";
const EYE_OFF_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2'%3E%3Cpath d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3Cline x1='3' y1='3' x2='21' y2='21'/%3E%3C/svg%3E";
// Icônes Feather (data-URI), même fabrique que l'œil. Dossier/image = clair ; poubelle = rouge (destructif).
const FOLDER_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23E5E7EB' stroke-width='2'%3E%3Cpath d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/%3E%3C/svg%3E";
const TRASH_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF4444' stroke-width='2'%3E%3Cpolyline points='3 6 5 6 21 6'/%3E%3Cpath d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/%3E%3Cline x1='10' y1='11' x2='10' y2='17'/%3E%3Cline x1='14' y1='11' x2='14' y2='17'/%3E%3C/svg%3E";
const IMAGE_URI  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239AA0AA' stroke-width='2'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpolyline points='21 15 16 10 5 21'/%3E%3C/svg%3E";

// Glisser-horizontal sur un champ numerique = +/-valeur (facon Blender). Sous 3px = clic (edition texte).
// Pendant le glisse : onChange a chaque pas (commits coalescees via {coalesce:'num'} cote appelant) ;
// au relache : breakCoalesce() pour clore la session d'undo (parite avec le focusout des champs num).
let numDragBreak = () => {};   // clot la session d'undo en fin de drag ; cable par createInspector (ou model est en portee)
function attachNumDrag(el, onChange) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startVal = Number(el.value) || 0;
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      ev.preventDefault();
      const v = numDragValue(startVal, dx, ev.shiftKey);
      el.value = String(v);
      onChange(v);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) numDragBreak();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// Construit un <input>/<select> selon kind. onChange recoit la valeur typee. Les editeurs textuels
// committent sur 'change' (pas 'input') pour ne pas inonder l'undo.
function makeInput(kind, value, onChange, placeholder) {
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
    if (placeholder != null) el.placeholder = String(placeholder);   // defaut firmware affiche en grise quand la cle est absente
    el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
    attachNumDrag(el, v => onChange(v));
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

export function createInspector(root, model, { selection, rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible, openDrawer } = {}) {
  numDragBreak = () => model.breakCoalesce();
  let sel = null; // { placeIndex, page, ref } ou null — RECALCULÉ depuis le store à chaque render()
  let placementInputs = {}; // { anchor, dx, dy } → <input>/<select> de la rubrique Placement, pour la MAJ live au drag

  // La sélection courante, dérivée du store : un composant existant, ou null (doc/page/null/périmé).
  // Le `ref` se DÉRIVE du placement (jamais stocké dans la sélection — cf. spec §1).
  const currentSel = () => {
    const s = selection.get();
    if (!s || s.kind !== 'comp') return null;
    const pl = model.state.pages?.[s.page]?.place?.[s.index];
    if (!pl) return null;
    return { placeIndex: s.index, page: s.page, ref: pl.ref };
  };

  const comp = () => sel && model.state.components[sel.ref];
  const place = () => sel && model.state.pages?.[sel.page]?.place?.[sel.placeIndex];

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

  function section(title, collapsed = false) {
    const sec = document.createElement('div'); sec.className = 'section' + (collapsed ? ' collapsed' : '');
    const h = document.createElement('div'); h.className = 'section-h';
    const car = document.createElement('span'); car.className = 'caret'; car.textContent = '▾';
    h.appendChild(car); h.appendChild(document.createTextNode(' ' + title));
    const bdy = document.createElement('div'); bdy.className = 'section-b';
    h.addEventListener('click', () => sec.classList.toggle('collapsed'));
    sec.appendChild(h); sec.appendChild(bdy);
    return { sec, body: bdy };
  }

  function renderExtras(body, c) {
    const p = place();
    // --- Géométrie du placement ---
    const gf = COMPONENTS[c.type].placeFields;
    if (gf.length) {
      const { sec: plSec, body: plBody } = section('Placement');
      if (c.type === 'ring') note(plBody, 'Anneau centré : ancrage/dx/dy ignorés par le firmware.');
      for (const [key, label, kind, ph] of gf) {
        const opts = kind === 'num' ? { coalesce: 'num' } : undefined;   // F2 : flèches/spinner d'un champ num = 1 entrée d'undo
        const input = makeInput(kind, p[key], v => model.commit(s => setPlacementProp(s, getActivePage(), sel.placeIndex, key, v), opts), ph);
        placementInputs[key] = input;   // réf. pour setLivePlacement (drag)
        plBody.appendChild(fieldRow(label, input));
      }
      body.appendChild(plSec);
    }

    // --- Seuils ring/meter (liste éditable de [limite, #couleur]) ---
    // ring : couleur si valeur < limite ; meter : zone d'arc (limite précédente → limite).
    if (c.type === 'ring' || c.type === 'meter' || c.type === 'bar') {
      const { sec: thSec, body: thBody } = section(c.type === 'meter' ? 'Zones (couleur de la limite précédente à la limite)'
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
        thBody.appendChild(row);
      });
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = '+ seuil';
      add.addEventListener('click', () => { ths.push([0, '#FF0000']); commitThs(); });
      thBody.appendChild(add);
      body.appendChild(thSec);
    }

    // --- États icon (table {at, symbol?, color?} ; 1re bande où valeur < at gagne ; omis = base) ---
    if (c.type === 'icon') {
      const { sec: stSec, body: stBody } = section('États (glyphe/couleur si valeur < seuil)');
      note(stBody, 'Vide = icône statique. « (base) » / couleur décochée = retombe sur le symbole/la couleur de base.');
      const ref = sel.ref;                                   // figée au rendu (cf. invariant inspecteur)
      const names = Object.keys(ICON_SVG);
      const st = (c.states || []).map(s => ({ ...s }));       // copie locale éditable
      const commit = (opts) => model.commit(s2 => setIconStates(s2, ref, st.map(e => ({
        at: e.at ?? 0,
        ...(e.symbol ? { symbol: e.symbol } : {}),
        ...(e.color ? { color: e.color } : {}),
      }))), opts);
      st.forEach((e, idx) => {
        const row = document.createElement('div'); row.className = 'insp-row';
        const at = makeInput('num', e.at, v => { st[idx].at = v === '' ? 0 : v; commit({ coalesce: 'num' }); });   // F2 num
        const symSel = document.createElement('select');
        const base = document.createElement('option'); base.value = ''; base.textContent = '(base)';
        symSel.appendChild(base);
        for (const nm of names) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; if (nm === e.symbol) o.selected = true; symSel.appendChild(o); }
        symSel.addEventListener('change', () => { st[idx].symbol = symSel.value || undefined; commit(); });
        const colOn = document.createElement('input'); colOn.type = 'checkbox'; colOn.checked = e.color != null; colOn.title = 'Forcer une couleur';
        const col = document.createElement('input'); col.type = 'color'; col.value = e.color || '#FF0000'; col.disabled = e.color == null;
        colOn.addEventListener('change', () => { col.disabled = !colOn.checked; st[idx].color = colOn.checked ? col.value.toUpperCase() : undefined; commit(); });
        col.addEventListener('change', () => { clearPreview?.(); st[idx].color = col.value.toUpperCase(); commit(); });
        // Aperçu live de la couleur de l'état : override du tableau states complet (canvas seul, hors modèle).
        col.addEventListener('input', () => { if (!colOn.checked) return; previewProp?.(ref, {
          states: st.map((e, i) => ({
            at: e.at ?? 0,
            ...(e.symbol ? { symbol: e.symbol } : {}),
            ...(i === idx ? { color: col.value.toUpperCase() } : (e.color ? { color: e.color } : {})),
          })),
        }); });
        const rm = document.createElement('button'); rm.className = 'insp-th-rm'; rm.textContent = '×';
        rm.addEventListener('click', () => { st.splice(idx, 1); commit(); });
        row.append(at, symSel, colOn, col, rm);
        stBody.appendChild(row);
      });
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = '+ état';
      add.addEventListener('click', () => { st.push({ at: 0, symbol: names[0] }); commit(); });
      stBody.appendChild(add);
      body.appendChild(stSec);
    }

    // --- Valeur d'aperçu (mock) : hors layout, re-rend le canvas sans toucher au modèle/undo ---
    const mf = COMPONENTS[c.type].mockFields;
    if (mf.length) {
      const { sec: mockSec, body: mockBody } = section('Aperçu (mock, non poussé au device)', true);
      const m = getMock(sel.ref, c.type);
      for (const [key, label] of mf) {
        const input = makeInput('num', m[key], v => {
          setMock(sel.ref, { [key]: v === '' ? 0 : v });
          rerenderCanvas && rerenderCanvas();
        });
        mockBody.appendChild(fieldRow(label, input));
      }
      body.appendChild(mockSec);
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
    const pick = document.createElement('button');                              // .insp-bg-file est masqué (CSS) : un bouton dossier l'ouvre, comme le fond
    pick.type = 'button'; pick.className = 'insp-iconbtn';
    pick.title = c.src ? "Changer l'image" : "Choisir une image";
    const pickIcon = document.createElement('img');
    pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
    pick.appendChild(pickIcon);
    pick.addEventListener('click', () => file.click());
    row.appendChild(pick);
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
    const pick = document.createElement('button');                              // .insp-bg-file est masqué (CSS) : un bouton dossier l'ouvre, comme le fond
    pick.type = 'button'; pick.className = 'insp-iconbtn';
    pick.title = c.src ? "Changer l'animation" : "Choisir une animation";
    const pickIcon = document.createElement('img');
    pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
    pick.appendChild(pickIcon);
    pick.addEventListener('click', () => file.click());
    row.appendChild(pick);
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

  // Champ « Fond » d'une forme : case « Remplir » + couleur. Décochée → fill supprimé (= pas de fond,
  // contour seul). Un <input type=color> natif ne peut pas être vide → la case porte l'état présent/absent.
  // Commit sur 'change' (pas d'aperçu live ici, contrairement aux color pickers génériques).
  function fillField(label, c) {
    const ref = sel.ref;                                  // figée au rendu (cf. invariant inspecteur)
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
    row.appendChild(span);
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = c.fill != null;
    on.title = 'Remplir le fond';
    const col = document.createElement('input'); col.type = 'color'; col.value = c.fill || '#38BDF8';
    col.disabled = c.fill == null;
    on.addEventListener('change', () => {
      col.disabled = !on.checked;   // retour immédiat (le garde-focus de render() saute le rebuild tant que la case a le focus)
      model.commit(s => setComponentProp(s, ref, 'fill', on.checked ? (col.value.toUpperCase()) : null));
    });
    col.addEventListener('change', () => {
      if (col.disabled) return;   // fond désactivé : pas de commit
      model.commit(s => setComponentProp(s, ref, 'fill', col.value.toUpperCase()));
    });
    row.append(on, col);
    return row;
  }

  // Rien de sélectionné (null / sélection périmée / ref orpheline) : placeholder neutre. Cohérence stricte
  // arbre↔inspecteur (Option 1) : on n'édite rien tant que rien n'est sélectionné.
  function renderEmpty(body) {
    const tip = document.createElement('p'); tip.className = 'todo';
    tip.textContent = 'Rien de sélectionné — choisis un élément dans l’arbre, ou un widget sur le canvas.';
    body.appendChild(tip);
  }

  // Vue Document : params globaux du layout. title (poussé au device → ASCII) + background (couleur globale)
  // + nav.wrap (boucle de navigation). Reprend l'édition inline title/background de l'ancien renderPagePanel.
  function renderDoc(body) {
    const s = model.state;
    const head = document.createElement('div'); head.className = 'insp-head';
    const htitle = document.createElement('span'); htitle.textContent = 'Document';
    head.appendChild(htitle);
    body.appendChild(head);

    const titleInput = makeInput('text', s.title ?? '', v => model.commit(st => { st.title = v; }));
    body.appendChild(fieldRow('Titre', titleInput, { ascii: true }));          // texte affiché par le device = ASCII
    const bg = makeInput('color', s.background || '#000000', v => model.commit(st => { st.background = v; }));
    body.appendChild(fieldRow('Fond', bg));

    sub(body, 'Navigation');
    // wrap : défaut firmware true (boucle). Coché = boucler (dernière → première) ; décoché = buter au bord.
    const wrap = s.nav?.wrap !== false;
    const cb = makeInput('bool', wrap, v => model.commit(st => setNavWrap(st, v)));
    body.appendChild(fieldRow('Boucler la navigation', cb));

    const np = s.pages?.length ?? 0;
    const nc = Object.keys(s.components || {}).length;
    note(body, `${np} page(s) · ${nc} composant(s)`);
    if (openDrawer) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'insp-link';
      link.textContent = 'Ouvrir la plomberie (Device) →';
      link.title = 'Sorties physiques (led_ring/sound) + sources pull';
      link.onclick = () => openDrawer();
      body.appendChild(link);
    }
  }

  // Vue Page : nom de la page (libellé designer — pas poussé au device, donc pas de garde ASCII ; garde-
  // doublon partagée avec l'arbre via pageNameTaken) + fond couleur (override/hérité) + image de fond.
  function renderPage(body, pi) {
    const s = model.state;
    const pg = s.pages?.[pi];
    if (!pg) { renderEmpty(body); return; }   // robustesse : page disparue (reorder/suppr concurrente)

    const head = document.createElement('div'); head.className = 'insp-head';
    const htitle = document.createElement('span'); htitle.textContent = `Page « ${pg.name || `Page ${pi + 1}`} »`;
    head.appendChild(htitle);
    body.appendChild(head);

    // Nom : commit sur change ; vide/inchangé → resync l'input ; doublon → toast + re-render (revient à pg.name).
    const name = makeInput('text', pg.name ?? '', v => {
      const nv = (v || '').trim();
      if (!nv || nv === (pg.name || '')) { render(); return; }
      if (pageNameTaken(s, nv, pi)) { showToast(`« ${nv} » est déjà utilisé`); render(); return; }
      model.commit(st => renamePage(st, pi, nv));
    });
    body.appendChild(fieldRow('Nom', name));

    // Fond de la page : override optionnel. (hérité) si absent (= fond global) ; ↺ pour réhériter sinon.
    const hasBgImg = !!pg.background_image;   // image présente → la couleur de page n'est plus qu'un repli
    const pbg = makeInput('color', pg.background || s.background || '#000000',
      v => model.commit(st => setPageBackground(st, pi, v)));
    const row = fieldRow('Fond page', pbg);
    if (hasBgImg) { row.classList.add('insp-row--fallback'); pbg.title = "Repli : ne s'affiche que si l'image de fond est absente."; }
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

    // Image de fond de la page : override optionnel, prime sur la couleur. File natif masqué, ouvert par le
    // bouton dossier ; conversion + upload au navigateur (bg-image.js) ; la clé (hash) est posée dans le layout.
    const imgRow = document.createElement('div'); imgRow.className = 'insp-row insp-bg-row';
    const imgLabel = document.createElement('span'); imgLabel.className = 'insp-label';
    imgLabel.textContent = 'Image de fond';
    imgRow.appendChild(imgLabel);
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.className = 'insp-bg-file';   // masqué (CSS), ouvert par le bouton dossier
    file.addEventListener('change', async () => {
      const f = file.files?.[0]; if (!f) return;
      try {
        const { key } = await imageFileToBg(f);
        model.commit(st => setPageBackgroundImage(st, pi, key));
      } catch (e) { console.error('bg image:', e); }
      file.value = '';
    });
    imgRow.appendChild(file);
    if (pg.background_image) {                                  // aperçu ; cadre « octets sur le device » si pas en cache local
      const u = previewUrl(pg.background_image);
      if (u) {
        const thumb = document.createElement('img');
        thumb.className = 'insp-bg-thumb'; thumb.src = u; thumb.alt = 'aperçu du fond';
        imgRow.appendChild(thumb);
      } else {
        const ph = document.createElement('span');
        ph.className = 'insp-bg-thumb insp-bg-thumb--empty';
        ph.title = 'Fond défini — aperçu indisponible (octets stockés sur le device)';
        const phIcon = document.createElement('img');
        phIcon.src = IMAGE_URI; phIcon.width = 18; phIcon.height = 18; phIcon.alt = '';
        ph.appendChild(phIcon);
        imgRow.appendChild(ph);
      }
    }
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'insp-iconbtn';
    pick.title = pg.background_image ? "Changer l'image" : "Choisir une image";
    const pickIcon = document.createElement('img');
    pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
    pick.appendChild(pickIcon);
    pick.addEventListener('click', () => file.click());
    imgRow.appendChild(pick);
    if (pg.background_image) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'insp-iconbtn';
      del.title = "Retirer l'image";
      const delIcon = document.createElement('img');
      delIcon.src = TRASH_URI; delIcon.width = 16; delIcon.height = 16; delIcon.alt = "Retirer l'image";
      del.appendChild(delIcon);
      del.addEventListener('click', () => model.commit(st => setPageBackgroundImage(st, pi, null)));
      imgRow.appendChild(del);
    }
    body.appendChild(imgRow);
    if (hasBgImg) note(body, "L'image de fond prime sur la couleur ; celle-ci sert de repli si l'image est absente du device.");

    const onPage = pg.place?.length ?? 0;
    note(body, `${onPage} composant(s) placé(s) sur cette page`);
  }

  // Vue Composant : props/géométrie/seuils/aperçu mock + œil d'en-tête + bouton device visible + suppr.
  // Contenu inchangé (extrait de l'ancien render()) ; F5 (ref figée au rendu) et coalesce num préservés.
  function renderComp(body, c) {
    const head = document.createElement('div'); head.className = 'insp-head';
    const kindSpan = document.createElement('span'); kindSpan.className = 'insp-head-kind'; kindSpan.textContent = c.type;
    head.appendChild(kindSpan);
    const nameSpan = document.createElement('span'); nameSpan.className = 'insp-head-name'; nameSpan.textContent = sel.ref;
    head.appendChild(nameSpan);
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

    const { sec: propSec, body: propBody } = section('Propriétés');
    const rows = {};
    for (const [key, label, kind, enableWhen] of COMPONENTS[c.type].compFields) {
      if (kind === 'image') { propBody.appendChild(imageField(label, c)); continue; }   // picker bespoke
      if (kind === 'image_anim') { propBody.appendChild(imageAnimField(label, c)); continue; }   // editeur bespoke
      if (kind === 'fill') { propBody.appendChild(fillField(label, c)); continue; }   // forme : fond optionnel (bespoke : enableWhen non supporté, comme image/image_anim)
      // Color picker : aperçu live sur 'input' (canvas seul, hors modèle → pas de flood undo) ; commit
      // unique sur 'change' (makeInput), précédé d'un clearPreview pour que le commit re-rende l'état réel.
      // ref figée au rendu : le color picker émet son 'change' en DIFFÉRÉ (après qu'un clic ailleurs a
      // déjà déplacé `sel`) ; sans figer, le commit atterrirait sur la sélection courante (mauvais
      // composant). On committe donc toujours sur le composant qu'on éditait. (cf. bug picker couleur)
      const ref = sel.ref;
      const placeIndex = sel.placeIndex;   // figé au rendu comme ref (orientation barre → swap W/H du placement)
      const commit = v => {
        if (kind === 'color') clearPreview?.();
        // Orientation barre : bascule + échange Largeur/Hauteur du placement en UN seul commit (1 undo).
        if (key === 'orientation' && c.type === 'bar') { model.commit(s => setBarOrientation(s, ref, getActivePage(), placeIndex, v)); return; }
        model.commit(s => setComponentProp(s, ref, key, v), kind === 'num' ? { coalesce: 'num' } : undefined);   // F2 : coalesce num
      };
      const input = makeInput(kind, c[key], commit);
      if (kind === 'color') input.addEventListener('input', () => previewProp?.(ref, { [key]: input.value.toUpperCase() }));
      const displayLabel = key === 'bind' ? '⛓ Variable (pull)' : label;
      const row = fieldRow(displayLabel, input, { ascii: kind === 'asciitext' });
      if (key === 'bind') row.classList.add('insp-source');
      rows[key] = { input, row, enableWhen };
      propBody.appendChild(row);
    }
    body.appendChild(propSec);
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
        dev.disabled = true;                            // évite des push concurrents au double-clic (réseau lent)
        try {
          const nextVisible = deviceHidden.has(ref);    // si caché -> on affiche ; sinon on cache
          const ok = await pushVisible(ref, nextVisible);
          if (ok) {
            if (nextVisible) deviceHidden.delete(ref); else deviceHidden.add(ref);
            dev.textContent = deviceHidden.has(ref) ? 'Afficher sur le device' : 'Cacher sur le device';
          }
        } finally {
          dev.disabled = false;
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
  }

  function render() {
    // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
    if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
    sel = currentSel();   // null sauf composant valide (le `ref` se DÉRIVE — cf. spec §1)
    if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'aperçu avant tout rebuild
    root.querySelectorAll('.insp-body').forEach(n => n.remove());
    placementInputs = {};   // les anciens champs viennent d'être retirés
    const body = document.createElement('div'); body.className = 'insp-body';
    const s = selection.get();
    const c = sel ? comp() : null;   // composant vivant (sel non-null ⇒ kind comp ; null si ref orpheline)
    if (c) {                                             // composant valide → vue Composant
      renderComp(body, c);
    } else if (s && s.kind === 'doc') {                  // nœud Document → globales
      renderDoc(body);
    } else if (s && s.kind === 'page' && model.state.pages?.[s.page]) {   // page existante → vue Page
      renderPage(body, s.page);
    } else {                                             // null / périmé / ref orpheline → placeholder
      renderEmpty(body);
    }
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
  selection.subscribe(render);   // changement de sélection (canvas/arbre) → reconstruire l'inspecteur
  render();
  return { setLivePlacement };
}

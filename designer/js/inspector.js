// Inspecteur : édite le composant + le placement sélectionnés. Pilote les champs par des tables de
// descripteurs (DRY). Chaque édition committée = UN commit (sur 'change', pas par frappe → pas de
// flood undo). Le signalement ASCII est live (sur 'input'). S'abonne au modèle pour se rafraîchir.
import { setComponentProp, setPlacementProp, setBarOrientation, setThresholds, setIconStates, removePlacementAndOrphan, setPageBackground, setPageBackgroundImage, setNavWrap, renamePage, pageNameTaken, isValidId } from './mutations.js';
import { showToast } from './toast.js';
import { imageFileToBg, previewUrl } from './bg-image.js';
import { imageFileToAsset, previewUrl as imagePreviewUrl } from './image-asset.js';
import { decodeGif, decodeImages, framesToAsset, previewUrls as aimgPreviewUrls } from './image-anim-asset.js';
import { COMPONENTS } from './registry.js';
import { ICON_SVG } from './render.js';
import { ANCHORS, ANCHORS_OUT } from './geometry.js';
import { getMock, setMock } from './mocks.js';
import { numDragValue } from './numdrag.js';
import { paintRing, ledFrame, ledFrameAt } from './led-ring-preview.js';
import { t } from './i18n.js';

const FONTS = [12, 14, 20, 24, 28, 36, 48, 64, 72, 80, 96];
// Selects à options fixes (value firmware → clé i18n ou libellé propre [symboles/familles : non traduits,
// t() retombe sur la chaîne]). Étend le motif anchor/anchorOut. Résolus par t() au rendu.
const SELECTS = {
  barmode:    [['normal', 'select.barmode.normal'], ['symmetrical', 'select.barmode.symmetrical']],
  orient:     [['horizontal', 'select.orient.horizontal'], ['vertical', 'select.orient.vertical']],
  arcmode:    [['normal', 'select.arcmode.normal'], ['symmetrical', 'select.arcmode.symmetrical'], ['reverse', 'select.arcmode.reverse']],
  dash:       [['solid', 'select.dash.solid'], ['dashed', 'select.dash.dashed'], ['dotted', 'select.dash.dotted']],
  symbol:     Object.keys(ICON_SVG).map(n => [n, n]),
  fontfamily: [['montserrat', 'Montserrat'], ['jetbrains_mono', 'JetBrains Mono'], ['lora', 'Lora'], ['inter', 'Inter']],
};
const nonLatin1 = v => /[^\x20-\x7E\xA0-\xFF]/.test(v ?? '');
const nonId = v => (v ?? '') !== '' && !/^[A-Za-z0-9_]+$/.test(v);

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
// au relache : breakCoalesce() pour clore la session d'undo (parite avec le focusout des champs num),
// via ce callback (cable par createInspector ou model est en portee). PAS un CustomEvent dispatche sur
// `el` (suggere en revue PR #7) : l'inspecteur se re-render a CHAQUE commit du drag, donc `el` est DETACHE
// du DOM au pointerup -> un event partant de `el` ne bubble plus jusqu'a #inspector (verifie au navigateur).
let numDragBreak = () => {};
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
    // Préréglages + la valeur courante si elle est hors préréglage (taille importée 8–120) : sinon le
    // select afficherait le 1er préréglage et un change committerait cette mauvaise valeur (écrasement).
    const cur = Number(value);
    const opts = (Number.isFinite(cur) && !FONTS.includes(cur)) ? [...FONTS, cur].sort((a, b) => a - b) : FONTS;
    for (const f of opts) { const o = document.createElement('option'); o.value = String(f); o.textContent = f + ' px'; if (f === (value ?? 20)) o.selected = true; el.appendChild(o); }
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
    for (const [val, txt] of opts) { const o = document.createElement('option'); o.value = val; o.textContent = t(txt); if (val === (value ?? opts[0][0])) o.selected = true; el.appendChild(o); }
    el.addEventListener('change', () => onChange(el.value));
  } else { // text / latintext / idtext
    el = document.createElement('input'); el.type = 'text'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value));
  }
  return el;
}

// Ligne libellé + champ (+ avertissement live selon le charset : 'latin1' ou 'id').
function fieldRow(label, input, { charset } = {}) {
  const row = document.createElement('label');
  row.className = 'insp-row';
  const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = label;
  row.appendChild(span); row.appendChild(input);
  const bad = charset === 'id' ? nonId : charset === 'latin1' ? nonLatin1 : null;
  if (bad) {
    const warn = document.createElement('span'); warn.className = 'insp-warn';
    warn.textContent = charset === 'id' ? '⚠ id' : '⚠ Latin-1';
    warn.style.display = bad(input.value) ? '' : 'none';
    input.addEventListener('input', () => { warn.style.display = bad(input.value) ? '' : 'none'; });
    row.appendChild(warn);
  }
  return row;
}

export function createInspector(root, model, { selection, rerenderCanvas, clearSelection, getActivePage = () => 0, previewProp, clearPreview, pushVisible, openDrawer } = {}) {
  numDragBreak = () => model.breakCoalesce();
  let sel = null; // { placeIndex, page, ref } | { ref, physical:true } ou null — RECALCULÉ depuis le store à chaque render()
  let placementInputs = {}; // { anchor, dx, dy } → <input>/<select> de la rubrique Placement, pour la MAJ live au drag
  let ledPreviewRaf = null;   // requestAnimationFrame de l'aperçu LED animé, ou null
  const stopLedPreview = () => { if (ledPreviewRaf) { cancelAnimationFrame(ledPreviewRaf); ledPreviewRaf = null; } };

  // La sélection courante, dérivée du store : un composant existant, ou null (doc/page/null/périmé).
  // Le `ref` se DÉRIVE du placement (jamais stocké dans la sélection — cf. spec §1).
  const currentSel = () => {
    const s = selection.get();
    if (s && s.kind === 'physical') return { ref: s.ref, physical: true };   // led_ring/sound : pas de placement
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
    const el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (el.type === 'number') model.breakCoalesce();
    else if (el.type === 'color') { clearPreview?.(); rerenderCanvas?.(); }
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
      const { sec: plSec, body: plBody } = section(t('inspector.sec.placement'));
      if (c.type === 'ring') note(plBody, t('inspector.note.ring_centered'));
      for (const [key, label, kind, ph] of gf) {
        const opts = kind === 'num' ? { coalesce: 'num' } : undefined;   // F2 : flèches/spinner d'un champ num = 1 entrée d'undo
        const input = makeInput(kind, p[key], v => model.commit(s => setPlacementProp(s, getActivePage(), sel.placeIndex, key, v), opts), ph);
        placementInputs[key] = input;   // réf. pour setLivePlacement (drag)
        plBody.appendChild(fieldRow(t(label), input));
      }
      body.appendChild(plSec);
    }

    // --- Seuils ring/meter (liste éditable de [limite, #couleur]) ---
    // ring : couleur si valeur < limite ; meter : zone d'arc (limite précédente → limite).
    if (c.type === 'ring' || c.type === 'meter' || c.type === 'bar') {
      const { sec: thSec, body: thBody } = section(c.type === 'meter' ? t('inspector.sec.zones')
                                                                       : t('inspector.sec.thresholds'));
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
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = t('inspector.btn.add_threshold');
      add.addEventListener('click', () => { ths.push([0, '#FF0000']); commitThs(); });
      thBody.appendChild(add);
      body.appendChild(thSec);
    }

    // --- États icon (table {at, symbol?, color?} ; 1re bande où valeur < at gagne ; omis = base) ---
    if (c.type === 'icon') {
      const { sec: stSec, body: stBody } = section(t('inspector.sec.states'));
      note(stBody, t('inspector.note.icon_states'));
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
        const base = document.createElement('option'); base.value = ''; base.textContent = t('inspector.opt.base');
        symSel.appendChild(base);
        for (const nm of names) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; if (nm === e.symbol) o.selected = true; symSel.appendChild(o); }
        symSel.addEventListener('change', () => { st[idx].symbol = symSel.value || undefined; commit(); });
        const colOn = document.createElement('input'); colOn.type = 'checkbox'; colOn.checked = e.color != null; colOn.title = t('inspector.tip.force_color');
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
      const add = document.createElement('button'); add.className = 'insp-th-add'; add.textContent = t('inspector.btn.add_state');
      add.addEventListener('click', () => { st.push({ at: 0, symbol: names[0] }); commit(); });
      stBody.appendChild(add);
      body.appendChild(stSec);
    }

    // --- Valeur d'aperçu (mock) : hors layout, re-rend le canvas sans toucher au modèle/undo ---
    const mf = COMPONENTS[c.type].mockFields;
    if (mf.length) {
      const { sec: mockSec, body: mockBody } = section(t('inspector.sec.mock'), true);
      const m = getMock(sel.ref, c.type);
      for (const [key, label] of mf) {
        const input = makeInput('num', m[key], v => {
          setMock(sel.ref, { [key]: v === '' ? 0 : v });
          rerenderCanvas && rerenderCanvas();
        });
        mockBody.appendChild(fieldRow(t(label), input));
      }
      body.appendChild(mockSec);
    }
  }

  // Champ « Image » d'un composant image : file picker + miniature + reset. Convertit au navigateur a
  // la taille COURANTE du composant (c.w×c.h) et committe la cle dans `src` ; la source est memorisee
  // (image-asset) pour permettre le re-render au resize (cf. canvas.addImageHandles).
  function imageField(label, c) {
    const row = document.createElement('div'); row.className = 'insp-row';
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = t(label);
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
    pick.title = c.src ? t('inspector.tip.change_image') : t('inspector.tip.pick_image');
    const pickIcon = document.createElement('img');
    pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
    pick.appendChild(pickIcon);
    pick.addEventListener('click', () => file.click());
    row.appendChild(pick);
    if (c.src) {
      const thumb = document.createElement('img'); thumb.className = 'insp-bg-thumb';
      const u = imagePreviewUrl(c.src);
      if (u) thumb.src = u; else thumb.alt = t('inspector.alt.reload_device');
      row.appendChild(thumb);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'insp-bg-reset'; del.textContent = '↺';
      del.title = t('inspector.tip.remove_image');
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
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = t(label);
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
    pick.title = c.src ? t('inspector.tip.change_anim') : t('inspector.tip.pick_anim');
    const pickIcon = document.createElement('img');
    pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
    pick.appendChild(pickIcon);
    pick.addEventListener('click', () => file.click());
    row.appendChild(pick);
    if (c.src) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'insp-bg-reset'; del.textContent = '↺';
      del.title = t('inspector.tip.remove_anim');
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
        const fr = document.createElement('img'); fr.className = 'insp-aimg-frame'; fr.src = u;
        if (i === (c.rest_frame || 0)) fr.classList.add('is-rest');
        fr.title = t('inspector.tip.frame', { i });
        fr.addEventListener('click', () => model.commit(st => setComponentProp(st, sel.ref, 'rest_frame', i)));
        strip.appendChild(fr);
      });
      wrap.appendChild(strip);
      const play = document.createElement('button');
      play.type = 'button'; play.className = 'insp-aimg-play'; play.textContent = t('device.preview');
      play.addEventListener('click', () => {
        if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; play.textContent = t('device.preview'); return; }
        const node = document.querySelector(`#stage [data-ref="${sel.ref}"]`);
        const imgEl = node ? node.querySelector('.w-image-img') : null;
        if (!imgEl) return;
        let f = 0;
        play.textContent = t('device.preview_stop');
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
    const span = document.createElement('span'); span.className = 'insp-label'; span.textContent = t(label);
    row.appendChild(span);
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = c.fill != null;
    on.title = t('inspector.tip.fill_bg');
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
    tip.textContent = t('inspector.empty');
    body.appendChild(tip);
  }

  // Vue Document : params globaux du layout. title (poussé au device → ASCII) + background (couleur globale)
  // + nav.wrap (boucle de navigation). Reprend l'édition inline title/background de l'ancien renderPagePanel.
  function renderDoc(body) {
    const s = model.state;
    const head = document.createElement('div'); head.className = 'insp-head';
    const htitle = document.createElement('span'); htitle.textContent = t('inspector.doc.title');
    head.appendChild(htitle);
    body.appendChild(head);

    const titleInput = makeInput('text', s.title ?? '', v => model.commit(st => { st.title = v; }));
    body.appendChild(fieldRow(t('inspector.field.title'), titleInput, { charset: 'latin1' }));     // texte affiché par le device = Latin-1
    const bg = makeInput('color', s.background || '#000000', v => model.commit(st => { st.background = v; }));
    body.appendChild(fieldRow(t('inspector.field.bg'), bg));

    sub(body, t('inspector.sub.nav'));
    // wrap : défaut firmware true (boucle). Coché = boucler (dernière → première) ; décoché = buter au bord.
    const wrap = s.nav?.wrap !== false;
    const cb = makeInput('bool', wrap, v => model.commit(st => setNavWrap(st, v)));
    body.appendChild(fieldRow(t('inspector.field.nav_wrap'), cb));

    const np = s.pages?.length ?? 0;
    const nc = Object.keys(s.components || {}).length;                                  // total (inclut les sorties physiques)
    const placed = (s.pages || []).reduce((n, p) => n + (p.place?.length || 0), 0);     // placés sur les pages (= compte de la statusbar)
    note(body, t('inspector.note.doc_counts', { np, placed, nc }));
    if (openDrawer) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'insp-link';
      link.textContent = t('inspector.link.device');
      link.title = t('inspector.link.device_tip');
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
    const htitle = document.createElement('span'); htitle.textContent = t('inspector.page.title', { name: pg.name || t('page.default', { n: pi + 1 }) });
    head.appendChild(htitle);
    body.appendChild(head);

    // Nom : commit sur change ; vide/inchangé → resync l'input ; id invalide ou doublon → toast + re-render.
    const name = makeInput('text', pg.name ?? '', v => {
      const nv = (v || '').trim();
      if (!nv || nv === (pg.name || '')) { render(); return; }
      if (!isValidId(nv)) { showToast(t('page.invalid_name')); render(); return; }
      if (pageNameTaken(s, nv, pi)) { showToast(t('page.name_taken', { name: nv })); render(); return; }
      model.commit(st => renamePage(st, pi, nv));
    });
    body.appendChild(fieldRow(t('inspector.field.name'), name, { charset: 'id' }));

    // Fond de la page : override optionnel. (hérité) si absent (= fond global) ; ↺ pour réhériter sinon.
    const hasBgImg = !!pg.background_image;   // image présente → la couleur de page n'est plus qu'un repli
    const pbg = makeInput('color', pg.background || s.background || '#000000',
      v => model.commit(st => setPageBackground(st, pi, v)));
    const row = fieldRow(t('inspector.field.page_bg'), pbg);
    if (hasBgImg) { row.classList.add('insp-row--fallback'); pbg.title = t('inspector.tip.page_bg_fallback'); }
    if (pg.background == null) {
      const hint = document.createElement('span'); hint.className = 'insp-bg-hint'; hint.textContent = t('inspector.hint.inherited');
      row.appendChild(hint);
    } else {
      const reset = document.createElement('button');
      reset.type = 'button'; reset.className = 'insp-bg-reset'; reset.textContent = '↺';
      reset.title = t('inspector.tip.inherit_bg');
      reset.addEventListener('click', () => model.commit(st => setPageBackground(st, pi, null)));
      row.appendChild(reset);
    }
    body.appendChild(row);

    // Image de fond de la page : override optionnel, prime sur la couleur. File natif masqué, ouvert par le
    // bouton dossier ; conversion + upload au navigateur (bg-image.js) ; la clé (hash) est posée dans le layout.
    const imgRow = document.createElement('div'); imgRow.className = 'insp-row insp-bg-row';
    const imgLabel = document.createElement('span'); imgLabel.className = 'insp-label';
    imgLabel.textContent = t('inspector.field.bg_image');
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
        thumb.className = 'insp-bg-thumb'; thumb.src = u; thumb.alt = t('inspector.alt.bg_preview');
        imgRow.appendChild(thumb);
      } else {
        const ph = document.createElement('span');
        ph.className = 'insp-bg-thumb insp-bg-thumb--empty';
        ph.title = t('inspector.tip.bg_unavailable');
        const phIcon = document.createElement('img');
        phIcon.src = IMAGE_URI; phIcon.width = 18; phIcon.height = 18; phIcon.alt = '';
        ph.appendChild(phIcon);
        imgRow.appendChild(ph);
      }
    }
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'insp-iconbtn';
    pick.title = pg.background_image ? t('inspector.tip.change_image') : t('inspector.tip.pick_image');
    const pickIcon = document.createElement('img');
    pickIcon.src = FOLDER_URI; pickIcon.width = 16; pickIcon.height = 16; pickIcon.alt = pick.title;
    pick.appendChild(pickIcon);
    pick.addEventListener('click', () => file.click());
    imgRow.appendChild(pick);
    if (pg.background_image) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'insp-iconbtn';
      del.title = t('inspector.tip.remove_image');
      const delIcon = document.createElement('img');
      delIcon.src = TRASH_URI; delIcon.width = 16; delIcon.height = 16; delIcon.alt = t('inspector.tip.remove_image');
      del.appendChild(delIcon);
      del.addEventListener('click', () => model.commit(st => setPageBackgroundImage(st, pi, null)));
      imgRow.appendChild(del);
    }
    body.appendChild(imgRow);
    if (hasBgImg) note(body, t('inspector.note.bg_image_priority'));

    const onPage = pg.place?.length ?? 0;
    note(body, t('inspector.note.page_count', { n: onPage }));
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
      eye.title = visible ? t('tree.eye.visible') : t('tree.eye.hidden');
      const icon = document.createElement('img');
      icon.src = visible ? EYE_OPEN_URI : EYE_OFF_URI;
      icon.width = 15; icon.height = 15; icon.alt = visible ? t('tree.eye.alt_visible') : t('tree.eye.alt_hidden');
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
    if (c.type === 'sound') note(body, t('device.note_sound'));   // physique sans champ : note d'usage

    if (COMPONENTS[c.type].compFields.length) {   // sound n'a aucun champ → pas de rubrique vide
      const { sec: propSec, body: propBody } = section(t('inspector.sec.props'));
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
        const displayLabel = key === 'bind' ? '⛓ ' + t('field.bind') : t(label);
        const row = fieldRow(displayLabel, input, { charset: kind === 'idtext' ? 'id' : kind === 'latintext' ? 'latin1' : undefined });
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
    }

    renderExtras(body, c); // Task 6

    if (c.type === 'led_ring') {
      const ref = sel.ref;                                   // figé au rendu (cf. invariant inspecteur)
      const liveComp = () => model.state.components[ref] || c;
      const mini = document.createElement('div'); mini.className = 'led-ring-mini';
      paintRing(mini, ledFrame(liveComp(), getMock(ref, 'led_ring')));
      body.appendChild(mini);

      const play = document.createElement('button'); play.className = 'src-add'; play.textContent = t('device.preview');
      play.addEventListener('click', () => {
        if (ledPreviewRaf) { stopLedPreview(); play.blur(); play.textContent = t('device.preview'); paintRing(mini, ledFrame(liveComp(), getMock(ref, 'led_ring'))); return; }   // blur : libère le focus → render() peut reconstruire (cf. œil)
        play.textContent = t('device.preview_stop');
        const loop = () => { paintRing(mini, ledFrameAt(liveComp(), getMock(ref, 'led_ring'), performance.now())); ledPreviewRaf = requestAnimationFrame(loop); };
        loop();
      });
      body.appendChild(play);

      // Repeint le mini (frame statique) sur tout 'change' de l'inspecteur (mode/couleur/luminosité/valeur mock),
      // sauf pendant l'animation ▶. Sans rebuild → reste à jour même quand le garde-focus bloque render().
      body.addEventListener('change', () => { if (!ledPreviewRaf) paintRing(mini, ledFrame(liveComp(), getMock(ref, 'led_ring'))); });
    }

    if (!COMPONENTS[c.type].physical && pushVisible) {
      const ref = sel.ref;
      const dev = document.createElement('button');
      dev.className = 'insp-devvis';
      dev.textContent = deviceHidden.has(ref) ? t('inspector.btn.show_device') : t('inspector.btn.hide_device');
      dev.addEventListener('click', async () => {
        dev.disabled = true;                            // évite des push concurrents au double-clic (réseau lent)
        try {
          const nextVisible = deviceHidden.has(ref);    // si caché -> on affiche ; sinon on cache
          const ok = await pushVisible(ref, nextVisible);
          if (ok) {
            if (nextVisible) deviceHidden.delete(ref); else deviceHidden.add(ref);
            dev.textContent = deviceHidden.has(ref) ? t('inspector.btn.show_device') : t('inspector.btn.hide_device');
          }
        } finally {
          dev.disabled = false;
        }
      });
      body.appendChild(dev);
    }

    if (!COMPONENTS[c.type].physical) {                    // physique : permanent, pas de retrait
      const del = document.createElement('button'); del.className = 'insp-del'; del.textContent = t('inspector.btn.remove_from_page');
      del.addEventListener('click', () => {
        const i = sel.placeIndex;
        sel = null;
        clearSelection && clearSelection();                 // désélectionne AVANT le commit (évite le flash, note C1-c)
        model.commit(s => removePlacementAndOrphan(s, getActivePage(), i));
      });
      body.appendChild(del);
    }
  }

  function render() {
    // garde focus : ne pas reconstruire pendant qu'un champ de l'inspecteur est en cours d'édition.
    if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
    sel = currentSel();   // null sauf composant valide (le `ref` se DÉRIVE — cf. spec §1)
    if (_aimgPreviewTimer) { clearInterval(_aimgPreviewTimer); _aimgPreviewTimer = null; }   // stoppe l'aperçu avant tout rebuild
    stopLedPreview();   // un aperçu LED en cours pointerait un nœud bientôt détaché
    root.querySelectorAll('.insp-body').forEach(n => n.remove());
    placementInputs = {};   // les anciens champs viennent d'être retirés
    const body = document.createElement('div'); body.className = 'insp-body';
    const s = selection.get();
    const c = sel ? comp() : null;   // composant vivant (sel non-null ⇒ kind comp ou physical ; null si ref orpheline)
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

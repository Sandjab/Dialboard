// Panneau d'édition des sinks (push réseau réactif top-level, hors canvas). Miroir de sources.js :
// commit sur 'change' (1 undo/édition), garde-focus, headers édités en paires. Spécifique aux sinks :
// method (select), debounce_ms (num), body (gabarit JSON parsé — {{var}} vit dans une chaîne JSON ;
// le firmware fait serializeJson(body) → body DOIT être une valeur JSON, pas une chaîne brute).
import {
  uniqueSinkName, addSink, removeSink,
  setSinkProp, setSinkHeaders, setSinkBody
} from './mutations.js';
import { t } from './i18n.js';

const MAX_SINKS = 6, MAX_PAIRS = 4;   // miroir config.h (MAX_SINKS=6, MAX_HEADERS_PER_SINK=4)
const METHODS = ['POST', 'PUT', 'GET'];

// Convertit un objet {k:v} en liste de paires editables [[k,v],...].
const toPairs = obj => Object.entries(obj || {}).map(([k, v]) => [k, v]);
// Reconstruit un objet depuis des paires, en ignorant celles a cle vide.
const fromPairs = pairs => Object.fromEntries(pairs.filter(([k]) => k !== ''));

function textInput(value, onChange, placeholder) {
  const el = document.createElement('input');
  el.type = 'text'; el.value = value ?? ''; if (placeholder) el.placeholder = placeholder;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function numInput(value, onChange) {
  const el = document.createElement('input');
  el.type = 'number'; el.value = value ?? '';
  el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
  return el;
}

function selectInput(value, options, onChange) {
  const el = document.createElement('select');
  for (const opt of options) { const o = document.createElement('option'); o.value = opt; o.textContent = opt; if (opt === value) o.selected = true; el.appendChild(o); }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function row(...kids) {
  const r = document.createElement('div'); r.className = 'src-row';
  for (const k of kids) r.appendChild(k);
  return r;
}

function labelled(text, input) {
  const l = document.createElement('label'); l.className = 'src-field';
  const s = document.createElement('span'); s.textContent = text;
  l.appendChild(s); l.appendChild(input);
  return l;
}

// Éditeur du corps : gabarit JSON. Vide → défaut typé firmware (clé body supprimée). Sinon JSON.parse :
// succès → objet stocké ; échec → avertissement, pas de commit (le dernier objet valide reste au modèle).
function bodyField(sink, onCommit) {
  const box = document.createElement('div'); box.className = 'src-field';
  const s = document.createElement('span'); s.textContent = t('sinks.body');
  const ta = document.createElement('textarea'); ta.rows = 2; ta.className = 'snk-body';
  ta.value = sink.body != null ? JSON.stringify(sink.body) : '';
  ta.placeholder = t('sinks.body_ph');
  const warn = document.createElement('span'); warn.className = 'insp-warn'; warn.textContent = t('sinks.body_invalid');
  warn.style.display = 'none';
  ta.addEventListener('change', () => {
    const txt = ta.value.trim();
    if (txt === '') { warn.style.display = 'none'; onCommit(null); return; }
    try { const obj = JSON.parse(txt); warn.style.display = 'none'; onCommit(obj); }
    catch { warn.style.display = ''; }   // invalide : pas de commit
  });
  box.append(s, ta, warn);
  return box;
}

export function createSinks(root, model) {
  function render() {
    // Garde-focus : ne sauter le re-render QUE pendant l'édition d'un CHAMP (input/select/textarea).
    // Un bouton focalisé (Supprimer / + sink) ne doit PAS bloquer : Chrome focalise le bouton au clic,
    // sinon l'ajout/suppression de sink ne se reflète pas immédiatement.
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    root.replaceChildren();
    const sinks = model.state.sinks || [];

    sinks.forEach((snk, i) => {
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = snk.name || t('sinks.default_name', { n: i + 1 });
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = t('sinks.delete');
      del.addEventListener('click', () => model.commit(s => removeSink(s, i)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);

      card.appendChild(labelled(t('sinks.name'), textInput(snk.name, v => model.commit(s => setSinkProp(s, i, 'name', v)))));
      card.appendChild(labelled(t('sinks.watch'), textInput(snk.watch, v => model.commit(s => setSinkProp(s, i, 'watch', v)))));
      card.appendChild(labelled(t('sinks.method'), selectInput(snk.method || 'POST', METHODS, v => model.commit(s => setSinkProp(s, i, 'method', v)))));
      card.appendChild(labelled(t('sinks.url'), textInput(snk.url, v => model.commit(s => setSinkProp(s, i, 'url', v)), 'https://…')));
      card.appendChild(labelled(t('sinks.debounce'), numInput(snk.debounce_ms, v => model.commit(s => setSinkProp(s, i, 'debounce_ms', v)))));

      // Headers (paires nom -> valeur ; "$nom" = secret)
      card.appendChild(pairEditor(
        t('sinks.headers'), toPairs(snk.headers), t('sinks.name'), t('sinks.value'),
        pairs => model.commit(s => setSinkHeaders(s, i, fromPairs(pairs)))
      ));

      // Body (gabarit JSON)
      card.appendChild(bodyField(snk, body => model.commit(s => setSinkBody(s, i, body))));

      root.appendChild(card);
    });

    const add = document.createElement('button'); add.className = 'src-add';
    add.textContent = t('sinks.add');
    add.disabled = sinks.length >= MAX_SINKS;
    add.addEventListener('click', () => model.commit(s => addSink(s, uniqueSinkName(s))));
    root.appendChild(add);
  }

  // Éditeur de paires (headers) : identique à sources.js (ligne locale sans commit ; commit sur 'change').
  function pairEditor(title, pairs, kPlaceholder, vPlaceholder, onCommit) {
    const box = document.createElement('div'); box.className = 'src-pairs';
    const sub = document.createElement('div'); sub.className = 'src-sub'; sub.textContent = title;
    box.appendChild(sub);
    const rowsBox = document.createElement('div'); box.appendChild(rowsBox);
    const add = document.createElement('button'); add.className = 'src-pair-add'; add.textContent = '+';

    const addRow = idx => {
      const k = textInput(pairs[idx][0], v => { pairs[idx][0] = v; onCommit(pairs); }, kPlaceholder);
      const v = textInput(pairs[idx][1], v => { pairs[idx][1] = v; onCommit(pairs); }, vPlaceholder);
      const rm = document.createElement('button'); rm.className = 'src-pair-rm'; rm.textContent = '×';
      rm.addEventListener('click', () => { pairs.splice(idx, 1); onCommit(pairs); });
      rowsBox.appendChild(row(k, v, rm));
    };
    pairs.forEach((_, idx) => addRow(idx));

    add.disabled = pairs.length >= MAX_PAIRS;
    add.addEventListener('click', () => {
      if (pairs.length >= MAX_PAIRS) return;
      pairs.push(['', '']);
      addRow(pairs.length - 1);                    // ligne locale, PAS de commit (cle vide => filtree)
      add.disabled = pairs.length >= MAX_PAIRS;
    });
    box.appendChild(add);
    return box;
  }

  model.subscribe(render);
  render();
  return { render };
}

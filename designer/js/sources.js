// Panneau d'edition des sources de pull (config reseau top-level, hors canvas). Commit sur 'change'
// (1 undo/edition, pas de flood). headers/vars edites comme listes de paires, reconstruits en objets
// au commit (meme pattern que l'editeur de seuils du ring). S'abonne au modele ; garde-focus pour ne
// pas reconstruire pendant la frappe. Les SECRETS ne sont PAS geres ici (POST /secrets manuel).
import {
  uniqueSourceName, addSource, removeSource,
  setSourceProp, setSourceHeaders, setSourceVars
} from './mutations.js';

const MAX_SOURCES = 6, MAX_PAIRS = 6;  // miroir config.h (MAX_SOURCES, MAX_HEADERS/VARS_PER_SOURCE=4/6)

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

export function createSources(root, model) {
  function render() {
    // Garde-focus : ne sauter le re-render QUE pendant l'édition d'un CHAMP (input/select/textarea).
    // Un bouton focalisé (Supprimer / + source) ne doit PAS bloquer : Chrome focalise le bouton au clic,
    // sinon l'ajout/suppression de source ne se reflète pas immédiatement.
    const ae = document.activeElement;
    if (root.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    root.replaceChildren();
    const sources = model.state.sources || [];

    sources.forEach((src, i) => {
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = src.name || `source ${i + 1}`;
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = 'Supprimer';
      del.addEventListener('click', () => model.commit(s => removeSource(s, i)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);

      card.appendChild(labelled('Nom', textInput(src.name, v => model.commit(s => setSourceProp(s, i, 'name', v)))));
      card.appendChild(labelled('URL', textInput(src.url, v => model.commit(s => setSourceProp(s, i, 'url', v)), 'https://…')));
      card.appendChild(labelled('Intervalle (s)', numInput(src.interval_s, v => model.commit(s => setSourceProp(s, i, 'interval_s', v)))));

      // --- Headers (paires nom -> valeur ; "$nom" = reference a un secret) ---
      card.appendChild(pairEditor(
        'En-tetes (valeur "$nom" = secret)', toPairs(src.headers), 'Nom', 'Valeur',
        pairs => model.commit(s => setSourceHeaders(s, i, fromPairs(pairs)))
      ));

      // --- Vars (paires nom -> JSON Pointer) ---
      card.appendChild(pairEditor(
        'Variables (nom -> JSON Pointer)', toPairs(src.vars), 'Variable', '/chemin/json',
        pairs => model.commit(s => setSourceVars(s, i, fromPairs(pairs)))
      ));

      root.appendChild(card);
    });

    const add = document.createElement('button'); add.className = 'src-add';
    add.textContent = '+ source';
    add.disabled = sources.length >= MAX_SOURCES;
    add.addEventListener('click', () => model.commit(s => addSource(s, uniqueSourceName(s))));
    root.appendChild(add);
  }

  // Editeur generique de map (headers/vars) : liste de paires + ligne d'ajout. Le commit n'a lieu
  // que sur 'change' d'un champ. Une paire a cle vide est filtree par fromPairs (donc perdue au
  // re-render global) : le bouton "+" insere la ligne LOCALEMENT, sans commit, et c'est la saisie
  // de la cle (sur 'change') qui declenche le commit — la paire reapparait alors via toPairs.
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

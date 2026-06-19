// Panneau « Device » : édite les composants physiques (sorties globales : led_ring, sound), HORS pages.
// Ils vivent dans `components` sans placement ; le firmware les pilote globalement. Calqué sur
// sources.js (cards, commit sur 'change', garde-focus). Réutilise les classes CSS src-* (zéro CSS neuf).
import { COMPONENTS } from './registry.js';
import { setComponentProp } from './mutations.js';
import { physicalTypes, physicalComponentIds, addPhysicalComponent, removeComponent, canAddType } from './physical.js';

function fieldInput(kind, value, onChange) {
  const el = document.createElement('input');
  if (kind === 'color') {
    el.type = 'color'; el.value = value || '#FFFFFF';
    el.addEventListener('change', () => onChange(el.value.toUpperCase()));
  } else if (kind === 'num') {
    el.type = 'number'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value === '' ? '' : Number(el.value)));
  } else {
    el.type = 'text'; el.value = value ?? '';
    el.addEventListener('change', () => onChange(el.value));
  }
  return el;
}

function labelled(text, input) {
  const l = document.createElement('label'); l.className = 'src-field';
  const s = document.createElement('span'); s.textContent = text;
  l.appendChild(s); l.appendChild(input);
  return l;
}

export function createDevicePanel(root, model) {
  function render() {
    // Garde-focus : ne pas reconstruire pendant l'édition d'un champ du panneau.
    if (root.contains(document.activeElement) && document.activeElement !== document.body) return;
    root.replaceChildren();
    const comps = model.state.components || {};

    for (const id of physicalComponentIds(model.state)) {
      const c = comps[id];
      const def = COMPONENTS[c.type];
      const card = document.createElement('div'); card.className = 'src-card';

      const head = document.createElement('div'); head.className = 'src-head';
      const title = document.createElement('span'); title.className = 'src-title';
      title.textContent = `${id} · ${def.label}`;
      const del = document.createElement('button'); del.className = 'src-del'; del.textContent = 'Supprimer';
      del.addEventListener('click', () => model.commit(s => removeComponent(s, id)));
      head.appendChild(title); head.appendChild(del);
      card.appendChild(head);

      for (const [key, label, kind] of (def.compFields || [])) {
        card.appendChild(labelled(label, fieldInput(kind, c[key], v => model.commit(s => setComponentProp(s, id, key, v)))));
      }
      root.appendChild(card);
    }

    for (const type of physicalTypes()) {
      const add = document.createElement('button'); add.className = 'src-add';
      add.textContent = '+ ' + COMPONENTS[type].label;
      add.disabled = !canAddType(model.state, type);
      add.addEventListener('click', () => model.commit(s => addPhysicalComponent(s, type)));
      root.appendChild(add);
    }
  }

  model.subscribe(render);
  render();
  return { render };
}

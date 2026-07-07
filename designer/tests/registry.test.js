import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMPONENTS } from '../js/registry.js';
import { ANCHORS_OUT } from '../js/geometry.js';

const schema = JSON.parse(
  readFileSync(new URL('../../schema/layout.schema.json', import.meta.url))
);

// Types déclarés par le schema : component.oneOf → comp_* → properties.type.const.
function schemaTypes() {
  const defs = schema.$defs;
  return defs.component.oneOf.map(ref => {
    const name = ref.$ref.split('/').pop();   // '#/$defs/comp_ring' → 'comp_ring'
    return defs[name].properties.type.const;
  });
}

test('le registre couvre exactement les types du schema', () => {
  const reg = Object.keys(COMPONENTS).sort();
  const sch = schemaTypes().sort();
  assert.deepEqual(reg, sch);
});

test('geometry : ANCHORS_OUT = 8 positions sans CENTER', () => {
  assert.deepEqual(ANCHORS_OUT, ['TOP_LEFT','TOP_MID','TOP_RIGHT','LEFT_MID','RIGHT_MID','BOTTOM_LEFT','BOTTOM_MID','BOTTOM_RIGHT']);
});

test('registre : bar expose le style de label (couleur/police/align)', () => {
  const keys = COMPONENTS.bar.compFields.map(f => f[0]);
  assert.ok(keys.includes('label_color'));
  assert.ok(keys.includes('label_font'));
  assert.ok(keys.includes('label_align'));
  const d = COMPONENTS.bar.defaults();
  assert.equal(d.label_align, 'TOP_MID');
  assert.equal(d.label_font, 14);
  assert.equal(d.label_color, '#9AA0AA');
});

test('chaque entrée a les clés requises et un defaults() cohérent', () => {
  for (const [type, def] of Object.entries(COMPONENTS)) {
    for (const k of ['label', 'defaults', 'makePlacement', 'centered',
                     'physical', 'compFields', 'placeFields', 'mockFields', 'build']) {
      assert.ok(k in def, `${type} : clé '${k}' manquante`);
    }
    assert.equal(typeof def.defaults, 'function');
    assert.equal(def.defaults().type, type, `${type}.defaults().type doit valoir '${type}'`);
  }
});

test('registre : ring expose cap_prefix + style de police de la légende', () => {
  const keys = COMPONENTS.ring.compFields.map(f => f[0]);
  for (const k of ['cap_prefix', 'cap_font', 'cap_family', 'cap_bold', 'cap_italic']) {
    assert.ok(keys.includes(k), `${k} absent des compFields du ring`);
  }
  // défaut 14 px (parité avec le défaut firmware get_font, look actuel préservé)
  assert.equal(COMPONENTS.ring.defaults().cap_font, 14);
  // les champs de police du cap ne s'affichent que quand le cap est visible (countdown ou cap_prefix)
  const capFont = COMPONENTS.ring.compFields.find(f => f[0] === 'cap_font');
  assert.equal(typeof capFont[3], 'function');
  assert.equal(capFont[3]({}), false);
  assert.equal(capFont[3]({ countdown: true }), true);
  assert.equal(capFont[3]({ cap_prefix: 'Réf ' }), true);
});

test('registre : ring n’expose plus de pill (pastille supprimée)', () => {
  const keys = COMPONENTS.ring.compFields.map(f => f[0]);
  assert.ok(!keys.includes('pill'), 'pill ne doit plus figurer dans les compFields du ring');
  assert.equal(COMPONENTS.ring.defaults().pill, undefined, 'un ring neuf ne doit plus porter pill');
});

test('registre : rect/circle/line déclarés, statiques, non physiques', () => {
  for (const t of ['rect', 'circle', 'line']) {
    assert.ok(COMPONENTS[t], `${t} absent du registre`);
    assert.equal(COMPONENTS[t].physical, false);
    assert.equal(COMPONENTS[t].centered, false);
    assert.deepEqual(COMPONENTS[t].mockFields, [], `${t} : pas de mock (statique)`);
  }
});

test('registre : rect/circle exposent fill + contour', () => {
  for (const t of ['rect', 'circle']) {
    const keys = COMPONENTS[t].compFields.map(f => f[0]);
    assert.ok(keys.includes('fill'), `${t} : fill manquant`);
    assert.ok(keys.includes('border_width'), `${t} : border_width manquant`);
    assert.ok(keys.includes('border_color'), `${t} : border_color manquant`);
  }
  assert.ok(COMPONENTS.rect.placeFields.map(f => f[0]).includes('radius'));
  assert.ok(COMPONENTS.circle.placeFields.map(f => f[0]).includes('size'));
});

test('registre : label expose fond/contour (comp) + rayon de coin (placement)', () => {
  const keys = COMPONENTS.label.compFields.map(f => f[0]);
  assert.ok(keys.includes('fill'), 'label : fill manquant');
  assert.ok(keys.includes('border_width'), 'label : border_width manquant');
  assert.ok(keys.includes('border_color'), 'label : border_color manquant');
  assert.ok(keys.includes('pad_x'), 'label : pad_x manquant');
  assert.ok(keys.includes('pad_y'), 'label : pad_y manquant');
  // border_color n'est éditable que si border_width > 0 (même garde que rect)
  const bc = COMPONENTS.label.compFields.find(f => f[0] === 'border_color');
  assert.equal(typeof bc[3], 'function');
  assert.equal(bc[3]({ border_width: 0 }), false);
  assert.equal(bc[3]({ border_width: 2 }), true);
  assert.ok(COMPONENTS.label.placeFields.map(f => f[0]).includes('radius'), 'label : radius manquant');
  // Opt-in : un nouveau label reste sans fond, contour ni marge (transparent par défaut).
  const d = COMPONENTS.label.defaults();
  assert.equal(d.fill, undefined, 'un label neuf ne doit pas avoir de fond');
  assert.equal(d.border_width, undefined, 'un label neuf ne doit pas avoir de contour');
  assert.equal(d.pad_x, undefined, 'un label neuf ne doit pas avoir de marge interne');
  assert.equal(d.pad_y, undefined, 'un label neuf ne doit pas avoir de marge interne');
});

test('registre : line expose color/orientation/dash/rounded et longueur/épaisseur', () => {
  const cf = COMPONENTS.line.compFields.map(f => f[0]);
  for (const k of ['color', 'orientation', 'dash', 'rounded']) assert.ok(cf.includes(k), `line : ${k} manquant`);
  const pf = COMPONENTS.line.placeFields.map(f => f[0]);
  assert.ok(pf.includes('width'));
  assert.ok(pf.includes('thickness'));
  assert.equal(COMPONENTS.line.defaults().dash, 'solid');
  assert.equal(COMPONENTS.line.defaults().orientation, 'horizontal');
});

test('registre : icon déclaré, value-driven (mockFields value), non physique', () => {
  assert.ok(COMPONENTS.icon, 'icon absent du registre');
  assert.equal(COMPONENTS.icon.physical, false);
  assert.equal(COMPONENTS.icon.centered, false);
  assert.deepEqual(COMPONENTS.icon.mockFields, [['value', 'field.mock_value']]);
  const cf = COMPONENTS.icon.compFields.map(f => f[0]);
  for (const k of ['symbol', 'color', 'font', 'bind']) assert.ok(cf.includes(k), `icon : ${k} manquant`);
  const d = COMPONENTS.icon.defaults();
  assert.equal(d.symbol, 'bell');
  assert.equal(d.font, 28);
  assert.equal(d.color, '#FFFFFF');
});

test('registry : famille/gras/italique exposés sur les composants textuels, pas sur icon', () => {
  const keysOf = t => COMPONENTS[t].compFields.map(f => f[0]);
  for (const t of ['label', 'readout', 'ring']) {
    assert.ok(keysOf(t).includes('font_family'), `${t} doit exposer font_family`);
    assert.ok(keysOf(t).includes('bold'), `${t} doit exposer bold`);
    assert.ok(keysOf(t).includes('italic'), `${t} doit exposer italic`);
  }
  const barKeys = keysOf('bar');
  assert.ok(barKeys.includes('label_family') && barKeys.includes('label_bold') && barKeys.includes('label_italic'));
  assert.ok(!keysOf('icon').includes('font_family'), 'icon ne doit pas exposer font_family');
});

test('conformité : enum symbolName du schéma == noms de icons-data.js (set MDI généré)', async () => {
  const { ICONS } = await import('../vendor/icons/icons-data.js');
  const schemaNames = schema.$defs.symbolName.enum.slice().sort();
  const dataNames = ICONS.map(i => i.name).sort();
  assert.deepEqual(dataNames, schemaNames);
});

test('registre : led_ring expose mode/period_ms + value (mock), défaut mode off', () => {
  const cf = COMPONENTS.led_ring.compFields;
  const keys = cf.map(f => f[0]);
  for (const k of ['color', 'brightness', 'mode', 'period_ms']) {
    assert.ok(keys.includes(k), `led_ring : ${k} manquant`);
  }
  const period = cf.find(f => f[0] === 'period_ms');
  assert.equal(typeof period[3], 'function', 'period_ms doit porter un enableWhen (4e élément)');
  assert.equal(period[3]({ mode: 'spinner' }), true);
  assert.equal(period[3]({ mode: 'solid' }), false);
  assert.equal(period[3]({ mode: 'blink' }),    true,  'blink active period_ms');
  assert.equal(period[3]({ mode: 'breathe' }),  true,  'breathe active period_ms');
  assert.equal(period[3]({ mode: 'progress' }), false, 'progress : piloté par la valeur, period_ms grisé');
  assert.equal(period[3]({ mode: 'off' }),      false, 'off : period_ms grisé');
  assert.equal(COMPONENTS.led_ring.physical, true);
  assert.equal(COMPONENTS.led_ring.singleton, true);
  assert.deepEqual(COMPONENTS.led_ring.mockFields, [['value', 'field.mock_pct']]);
  assert.equal(COMPONENTS.led_ring.defaults().mode, 'off');
});

test('registre : switch expose bind seul + defaults()', () => {
  const keys = COMPONENTS.switch.compFields.map(f => f[0]);
  assert.deepEqual(keys, ['bind']);
  const d = COMPONENTS.switch.defaults();
  assert.equal(d.type, 'switch');
  assert.equal(COMPONENTS.switch.physical, false);
  assert.equal(COMPONENTS.switch.centered, false);
});

test('registre : button expose text/value/bind + defaults() (value string, radio set)', () => {
  const keys = COMPONENTS.button.compFields.map(f => f[0]);
  assert.deepEqual(keys, ['text', 'value', 'momentary', 'bind']);
  const d = COMPONENTS.button.defaults();
  assert.equal(d.type, 'button');
  assert.equal(typeof d.value, 'string');          // défaut string (set_is_num=false côté firmware)
  assert.equal(COMPONENTS.button.compFields.find(f => f[0] === 'value')[2], 'value');
});

test('registre : switch/button émettent width/height au placement (parité taille firmware)', () => {
  const sw = COMPONENTS.switch.makePlacement('sw1', 180, 180);
  assert.equal(sw.width, 60); assert.equal(sw.height, 30);
  const bt = COMPONENTS.button.makePlacement('bt1', 180, 180);
  assert.equal(bt.width, 100); assert.equal(bt.height, 44);
});

test('registre : slider/arc/roller présents, non physiques', () => {
  for (const t of ['slider', 'arc', 'roller']) {
    assert.ok(COMPONENTS[t], `${t} absent du registre`);
    assert.equal(COMPONENTS[t].physical, false);
    assert.equal(COMPONENTS[t].defaults().type, t);
  }
});

test('registre : compFields attendus (parité firmware)', () => {
  assert.deepEqual(COMPONENTS.slider.compFields.map(f => f[0]), ['bind', 'min', 'max', 'step', 'orientation', 'color']);
  assert.deepEqual(COMPONENTS.arc.compFields.map(f => f[0]), ['bind', 'min', 'max', 'step', 'mode', 'rounded', 'color']);
  assert.deepEqual(COMPONENTS.roller.compFields.map(f => f[0]), ['bind', 'options', 'rows']);
  assert.ok(COMPONENTS.button.compFields.some(f => f[0] === 'momentary' && f[2] === 'bool'));
});

test('registre : roller.options via kind bespoke "options"', () => {
  assert.equal(COMPONENTS.roller.compFields.find(f => f[0] === 'options')[2], 'options');
  assert.deepEqual(COMPONENTS.roller.defaults().options, ['OFF', 'ON']);
});

test('registre : slider/arc émettent les tailles/géométrie au placement', () => {
  const sl = COMPONENTS.slider.makePlacement('s1', 180, 180);
  assert.equal(sl.width, 200); assert.equal(sl.height, 16);
  const ar = COMPONENTS.arc.makePlacement('a1', 180, 180);
  assert.equal(ar.radius, 80); assert.equal(ar.thickness, 16); assert.equal(ar.gap_deg, 70);
});

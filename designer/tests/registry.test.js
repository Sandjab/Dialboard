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

test('registre : ring expose cap_prefix (légende courbe)', () => {
  const keys = COMPONENTS.ring.compFields.map(f => f[0]);
  assert.ok(keys.includes('cap_prefix'), 'cap_prefix absent des compFields du ring');
});

test('registre : ring pill est un toggle indépendant (plus d’exclusivité avec center_pct)', () => {
  const pill = COMPONENTS.ring.compFields.find(f => f[0] === 'pill');
  assert.equal(pill.length, 3, 'pill ne doit plus porter de garde enableWhen (4e élément) : il coexiste avec center_pct');
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

test('conformité : enum symbolName du schéma == clés de ICON_SVG (render.js)', async () => {
  const { ICON_SVG } = await import('../js/render.js');
  const schemaNames = schema.$defs.symbolName.enum.slice().sort();
  const svgNames = Object.keys(ICON_SVG).sort();
  assert.deepEqual(svgNames, schemaNames);
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

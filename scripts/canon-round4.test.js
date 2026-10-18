'use strict';

// Round 4 (READING.md §14): the real Careful reader on four unseen stories
// kept a later value as a second fact under another label, kept moments as
// traits, gave a pet a man's "he", believed a group chat, split a nurse from
// her nickname and three generations into one, and wrote profiles that said
// more than their facts. The dev3 stories (scripts/fixtures/canon-editor/dev3)
// were written for those types, and canon-perfect.js's drift reader fails the
// same way on purpose; these tests hold the engine to what it must still do.

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const P = require('./canon-perfect.js');

const S = Canon.Slots;
const FIX = path.join(__dirname, 'fixtures', 'canon-editor');
const N = (s) => Canon.norm(s);
const entry = (entries, name) => entries.find((e) => [e.name, ...e.aliases].some((n) => N(n) === N(name)));
const lines = (e) => (e ? e.facts.map((f) => `${Canon.labelOf(f)}: ${f.value} · ${f.state}`) : []);
const shown = (e) => (e ? e.facts.filter((f) => ['verified', 'yours', 'reading'].includes(f.state)) : []);

const runs = new Map();
async function run(name, mode = 'drift') {
  const k = name + '|' + mode;
  if (!runs.has(k)) runs.set(k, await P.runSheet(path.join(FIX, name), { mode, setting: P.SETTINGS[name] || '' }));
  return runs.get(k);
}
const slipOn = (r, words) => r.slips.find((s) => N(s.sentence).includes(N(words)));
const lookOn = (r, words) => r.asks.find((s) => N(s.sentence).includes(N(words)));

/* ---------- 1 · slots ---------- */

test('slots: a value\'s own shape says what it is a value of, whatever the label', () => {
  const got = (t, o) => S.claims(t, o).map((x) => `${x.slot}=${x.val}${x.sure ? '' : '?'}`);
  assert.deepEqual(got('Larch Ward was on the second floor of the east wing, a long room'), ['floor=2', 'wing=east']);
  assert.deepEqual(got('on the third-floor landing'), ['floor=3']);
  assert.deepEqual(got('Kerr’s Mill stood on the west bank of the Hobb'), ['bank=west']);
  assert.deepEqual(got('the bakery on Mill Lane'), ['street=mill lane']);
  assert.deepEqual(got('Her shift started at ten every night and ended at six'), ['time:start=600', 'time:end=360']);
  assert.deepEqual(got('Raff came on at eight, as she did every night'), ['time:start=480']);
  assert.deepEqual(got('Assembly in the Great Hall was at ten to nine every morning'), ['time:assembly=530']);
  assert.deepEqual(got('form tutor to Year Eleven'), ['year=11?']);
  assert.deepEqual(got('Hester Pell: teaches chemistry'), ['teaches=chemistry?']);
  assert.deepEqual(got('The science block stood next to the chapel, a red-brick building'), ['near=chapel?']);
  // a bare value, by its label: "Shift start: eight"
  assert.deepEqual(got('eight', { label: 'Shift start', bare: true }), ['time:start=480']);
  // no hour for "at ten years old", no floor for "nine floors"
  assert.deepEqual(got('at ten years old she left'), []);
  assert.deepEqual(got('The Lantern House had nine floors'), []);
});

test('slots: two values in one slot clash — sure when they can\'t both hold, a look when they may; an hour only between routines', () => {
  const c = (a, b) => { const x = S.clashOf(S.claims(a), S.claims(b)); return x ? (x.sure ? 'sure' : 'look') : null; };
  assert.equal(c('on the second floor of the east wing', 'on the third floor of the west wing'), 'sure');
  assert.equal(c('on the east bank', 'on the west bank'), 'sure');
  assert.equal(c('on Mill Lane', 'on Quay Road'), 'sure');
  assert.equal(c('by the ford', 'on Mill Lane'), null, 'a landmark and a street are two claims');
  assert.equal(c('next to the chapel', 'next to the sports hall'), 'look');
  assert.equal(c('Her shift started at ten every night', 'Raff came on at eight, as she did every night'), 'sure');
  assert.equal(c('Her shift started at ten every night', 'That night she came on at eight'), null, 'one late night is no routine');
  assert.equal(c('rose every morning at five', 'Her shift started at ten every night'), null, 'waking and a shift are two hours');
  assert.equal(c('teaches chemistry', 'taught biology'), 'look');
  // a person's floors are many things': only a place stands on one
  assert.deepEqual(S.factClaims({ label: 'Origin', value: 'born on the third floor' }, '', 'person'), []);
  // a sentence's claim is the entity's only in the clause it starts, with no one else between
  const about = (t, name, other = null) => {
    const at = [[t.indexOf(name), t.indexOf(name) + name.length]];
    const o = other ? [[t.indexOf(other), t.indexOf(other) + other.length]] : [];
    return S.claimsAbout(t, at, o, 'place').map((x) => `${x.slot}=${x.val}`);
  };
  assert.deepEqual(about('Larch Ward was on the third floor of the west wing.', 'Larch Ward'), ['floor=3', 'wing=west']);
  assert.deepEqual(about('Larch Ward was quiet; the third floor above it was empty.', 'Larch Ward'), []);
  assert.deepEqual(about('Larch Ward faced Rose Ward, on the third floor of the west wing.', 'Larch Ward', 'Rose Ward'), []);
  assert.deepEqual(about('Larch Ward had moved to the third floor of the west wing.', 'Larch Ward'), [], 'a change is no slip');
});

test('slots in a read: a later value under another label is never a second fact; the pass finds it (the drift reader says no to every slip question)', async () => {
  const nw = await run('dev3/night-ward');
  const ward = entry(nw.entries, 'Larch Ward');
  assert.ok(!shown(ward).some((f) => /third floor|west wing/.test(f.value)), lines(ward).join('\n'));
  assert.ok(slipOn(nw, 'Larch Ward was on the third floor'), 'the floor and wing slip');
  const km = await run('dev3/kerrs-mill');
  const mill = entry(km.entries, 'Kerr’s Mill');
  assert.ok(!shown(mill).some((f) => /west bank/.test(f.value)), lines(mill).join('\n'));
  assert.ok(slipOn(km, 'stood on the west bank'), 'the bank slip');
  const fr = await run('dev3/form-room');
  const hall = entry(fr.entries, 'the Great Hall');
  assert.ok(!shown(hall).some((f) => /half past eight/.test(f.value)), lines(hall).join('\n'));
  assert.ok(slipOn(fr, 'was at half past eight'), 'the assembly slip');
  // the science block's other neighbour: worth a look, never a slip
  assert.ok(!slipOn(fr, 'next to the sports hall'));
  assert.ok(lookOn(fr, 'next to the sports hall'), 'worth a look');
});

/* ---------- 2 · deeds ---------- */

test('deeds by rule: one done once, given later to another (a generation, a relative clause) is a slip with no question asked; done again, together, denied or said is none', () => {
  const mk = (id, name, kind, aliases = []) => ({ ...Canon.newEntry(name, kind, id), aliases });
  const ents = [mk('elder', 'Absalom Kerr the Elder', 'person', ['the Elder']), mk('younger', 'Absalom Kerr the Younger', 'person', ['the Younger']), mk('hester', 'Hester Pell', 'person', ['Hester']), mk('wilde', 'Jonah Wilde', 'person', ['Mr Wilde'])];
  const src = (id, ps) => ({ bookId: 'b', chId: id, book: 'B', label: id, html: ps.map((p) => `<p>${p}</p>`).join('') });
  const shelf = [
    src('c1', ['Absalom Kerr the Elder built the mill race at Hobb’s Ford in the spring of 1871.', 'Mr Wilde had planted the cedar on the front lawn.', 'The Younger kept the ledgers.']),
    src('c2', [
      'Visitors came to see the mill race, which Absalom Kerr the Younger had built in the spring of 1871.',
      'Nobody had touched the cedar that Hester Pell had planted on the front lawn.',
      'Hester planted a cedar of her own.',
      'The Younger built the mill race again after the flood.',
      'The Younger and the Elder built the mill race together, Sal thought.',
      '“The Younger built the mill race,” Sal said.',
      'Hester kept the ledgers that year.',
      'The Younger never built the mill race.'
    ])
  ];
  const slips = Canon.deedIndex(shelf, ents).filter((d) => d.against).map((d) => `${d.doer} ← ${d.against.doer}: ${d.sentence}`);
  assert.deepEqual(slips, [
    'younger ← elder: Visitors came to see the mill race, which Absalom Kerr the Younger had built in the spring of 1871.',
    'hester ← wilde: Nobody had touched the cedar that Hester Pell had planted on the front lawn.'
  ]);
});

test('deeds in a read: the drift reader (no to every who-did-it question) still meets both dev3 deed slips, and none is kept as the new doer\'s history', async () => {
  const km = await run('dev3/kerrs-mill');
  const s = slipOn(km, 'which Absalom Kerr the Younger had built');
  assert.ok(s && s.kind === 'event' && s.span === 'Absalom Kerr the Younger' && s.to === 'Absalom Kerr the Elder', JSON.stringify(s));
  const fr = await run('dev3/form-room');
  assert.ok(slipOn(fr, 'the cedar that Hester Pell had planted'));
  assert.ok(!shown(entry(fr.entries, 'Hester Pell')).some((f) => /cedar/.test(f.value)), lines(entry(fr.entries, 'Hester Pell')).join('\n'));
});

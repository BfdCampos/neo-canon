'use strict';

// Round 5 (READING.md §15): the real Careful reader on four more unseen
// stories caught 2 of 11 planted slips. A pet renamed and given another breed,
// a watch's start hour, a rank one step down, a deed given to a son by his
// nickname, eyes by an epithet, hair by a short name, a transposed room
// number, and the writer's notes against the prose all went by. The dev4
// stories (scripts/fixtures/canon-editor/dev4) were written for those types;
// the drift5 reader (canon-perfect.js) fails the way the brief says the real
// one did, and these tests hold the engine to what it must still do.

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const P = require('./canon-perfect.js');

const E = Canon.Editor;
const FIX = path.join(__dirname, 'fixtures', 'canon-editor');
const N = (s) => Canon.norm(s);
const entry = (entries, name) => entries.find((e) => [e.name, ...e.aliases].some((n) => N(n) === N(name)));
const lines = (e) => (e ? e.facts.map((f) => `${Canon.labelOf(f)}: ${f.value} · ${f.state}`) : []);

const runs = new Map();
async function run(name, mode = 'drift5') {
  const k = name + '|' + mode;
  if (!runs.has(k)) runs.set(k, await P.runSheet(path.join(FIX, name), { mode, setting: P.SETTINGS[name] || '' }));
  return runs.get(k);
}
const slipOn = (r, words) => r.slips.find((s) => N(s.sentence).includes(N(words)));
const lookOn = (r, words) => r.asks.find((s) => N(s.sentence).includes(N(words)));

/* ---------- 1 · words ---------- */

test('colours: the shades of hair and eyes, and "dark" against what it can\'t be', () => {
  assert.equal(Canon.COLOURS.ginger, 'red');
  assert.equal(Canon.COLOURS['iron-grey'], 'grey');
  assert.ok(Canon.colourClash('dark', 'red'));
  assert.ok(Canon.colourClash('dark', 'fair'));
  assert.ok(!Canon.colourClash('dark', 'black'));
  assert.ok(!Canon.colourClash('brown', 'dark'));
  assert.ok(Canon.colourClash('brown', 'black'));
});

test('breeds: a breed within its kind; two clash only when neither is the other\'s family', () => {
  assert.deepEqual(Canon.breedsIn('Her dog was a wire-haired fox terrier called Pickle').map((b) => `${b.key}/${b.fam}/${b.species}`), ['fox terrier/terrier/dog']);
  assert.deepEqual(Canon.breedsIn('Mrs Hollis’s little Jack Russell').map((b) => b.key), ['jack russell']);
  assert.ok(Canon.breedClash(Canon.breedOf('fox terrier'), Canon.breedOf('Jack Russell')));
  assert.ok(!Canon.breedClash(Canon.breedOf('fox terrier'), Canon.breedOf('terrier')));
  assert.ok(!Canon.breedClash(Canon.breedOf('Labrador'), Canon.breedOf('retriever')));
  assert.equal(Canon.breedsIn('a tabby cat')[0].species, 'cat');
});

test('a species from its breed: "dog, a black Labrador" from a sentence that never says dog', () => {
  assert.deepEqual(E.traitOf('species', 'dog, a black Labrador', 'She kept a black Labrador called Ness'), { attr: 'species', value: 'dog', as: 'Labrador' });
  assert.equal(E.traitOf('species', 'cat', 'a fat grey tom called Bellows'), null);
  assert.equal(E.traitOf('appearance.hair', 'ginger', 'with ginger hair').as, 'ginger');
});

/* ---------- 2 · reading (the perfect reader on dev4) ---------- */

test('a look in a colour is no moment; "a tall, quiet woman" is the kind she is; a creature brought in by name owns its apposition', async () => {
  const r = await run('dev4/carrick-head', 'perfect');
  const okafor = entry(r.entries, 'Okafor');
  assert.ok(lines(okafor).some((l) => /^Eyes: grey · verified$/.test(l)), lines(okafor).join('\n'));
  const ness = entry(r.entries, 'Ness');
  assert.ok(lines(ness).some((l) => /^Species: dog · verified$/.test(l)), lines(ness).join('\n'));
  assert.ok(lines(ness).some((l) => /^Habit: sleeps under the chart table/.test(l)), lines(ness).join('\n'));
  assert.ok(!lines(okafor).some((l) => /chart table/.test(l)), 'the dog\'s habit is not the owner\'s');
});

test('the writer\'s notes against the prose: Which is right?, and the notes are never marked', async () => {
  const r = await run('dev4/lugger', 'perfect');
  const carew = entry(r.entries, 'Thomas Carew');
  assert.ok(lines(carew).includes('Eyes: green · disagree') && lines(carew).includes('Eyes: brown · disagree'), lines(carew).join('\n'));
  assert.ok(![...r.slips, ...r.asks].some((s) => /eyes/.test(s.sentence)), [...r.slips, ...r.asks].map((s) => s.sentence).join('\n'));
});

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

/* ---------- 3 · ranks, short names, times ---------- */

test('ranks: a ladder each; one step down is a slip, the later one shortened is not, a promotion told is not', () => {
  const R = Canon.Refs;
  assert.ok(R.rankClash('Commander', 'Lieutenant Commander'));
  assert.ok(!R.rankClash('Lieutenant Commander', 'Commander'), 'how a lieutenant commander is spoken to');
  assert.ok(R.rankClash('Sergeant', 'Constable'));
  assert.ok(!R.rankClash('Detective Inspector', 'Inspector'));
  assert.ok(R.rankClash('Petty Officer', 'Chief Petty Officer'));
  assert.ok(!R.rankClash('Vicar', 'Sergeant'), 'two ladders never meet');
  assert.deepEqual(R.rankAt('That autumn Constable Pryce came', 'That autumn Constable '.length), { text: 'Constable', key: 'constable', start: 12, end: 21 });
  assert.equal(R.rankOfName('Commander Ruth Okafor').key, 'commander');
  assert.ok(R.RANK_CHANGE.test('Dunn had been made Chief Petty Officer in March'));
});

test('short names: the table\'s forms and a prefix of four letters or more', () => {
  const R = Canon.Refs;
  assert.ok(R.shortOf('Tom', 'Thomas'));
  assert.ok(R.shortOf('Bess', 'Elizabeth'));
  assert.ok(R.shortOf('Raff', 'Rafferty'));
  assert.ok(!R.shortOf('Tho', 'Thomas'));
  assert.ok(!R.shortOf('Jo', 'Thomas'));
});

test('times: the twenty-four hour clock and a range, its start and its end', () => {
  const S = Canon.Slots;
  const got = (t, o) => S.claims(t, o).map((x) => `${x.slot}=${x.val}`);
  assert.deepEqual(got('My watch ran from 2200 to 0600 every night'), ['time:start=600', 'time:end=360']);
  assert.deepEqual(got('I came on watch at 2300, as I did every night'), ['time:start=660']);
  assert.deepEqual(got('2200 to 0600', { label: 'shift', bare: true }), ['time:start=600', 'time:end=360']);
  const c = S.clashOf(S.claims('My watch ran from 2200 to 0600 every night'), S.claims('I came on watch at 2300, as I did every night'));
  assert.ok(c && c.sure && c.b.span === '2300');
  assert.deepEqual(got('He brought the weather report up to Hut 12 at four every morning.'), [], 'up is no waking');
});

test('the forms that refer: a rank one holds, the old one and the young one of a name, a short given name, the one dog', () => {
  const e = (id, name, kind, aliases, facts = []) => ({ id, name, kind, aliases, facts: facts.map(([attr, value, label]) => ({ attr, value, label, as: '', state: 'verified', sources: [{ quote: value, book: 'b', ch: 'c' }] })), setAside: [], story: [] });
  const entries = [
    e('okafor', 'Commander Ruth Okafor', 'person', ['Okafor']),
    e('senior', 'Josiah Tolland Senior', 'person', []), e('junior', 'Josiah Tolland Junior', 'person', []),
    e('carew', 'Thomas Carew', 'person', ['Carew']),
    e('pickle', 'Pickle', 'creature', [], [['species', 'dog'], ['other', 'Mrs Hollis’s dog', 'Possession']])
  ];
  const f = Canon.Refs.refForms(entries);
  const has = (id, p) => (f.get(id) || []).some((x) => x.phrase === p);
  assert.ok(has('okafor', 'the commander'));
  assert.ok(has('senior', 'the old man') && has('junior', 'the boy') && has('junior', 'young Josiah'));
  assert.ok(has('carew', 'Tom'));
  assert.ok((f.get('pickle') || []).some((x) => x.phrase === 'the dog' && x.strength === 'weak'));
});

/* ---------- 4 · the pass, with the drift5 reader (dev4) ---------- */

test('Carrick Head: the watch\'s hour, eyes by an epithet, a rank one step down, a renamed dog, a hut turned round', async () => {
  const r = await run('dev4/carrick-head');
  const want = [['I came on watch at 2300', '2300', null], ['The commander’s brown eyes', 'brown', 'grey'], ['Lieutenant Commander Okafor', 'Lieutenant Commander', 'Commander'], ['The commander’s Labrador, Bess', 'Bess', 'Ness'], ['Hut 21 with the signal', 'Hut 21', 'Hut 12']];
  for (const [at, span, to] of want) {
    const s = slipOn(r, at);
    assert.ok(s && s.span === span && s.strength === 'strong', at + ': ' + JSON.stringify(s));
    if (to) assert.equal(s.to, to);
  }
  // no false slip on the decoys: a promotion told as one, other people's ages, a route, a breakfast
  for (const d of ['made Chief Petty Officer', 'forty-four that winter', 'the long way round', 'at breakfast in the wardroom']) assert.ok(!slipOn(r, d) && !lookOn(r, d), d);
  assert.equal(r.slips.length, 5, r.slips.map((s) => s.span).join(', '));
  // the narrator, named by the radio and by a line of speech; the hut a place from its first mention; no Bess, no Hut 21
  const hale = entry(r.entries, 'Hale');
  assert.ok(hale && hale.aliases.some((a) => /Imogen/.test(a)) && hale.aliases.includes('Lieutenant Hale'), JSON.stringify(hale && [hale.name, hale.aliases]));
  assert.ok(entry(r.entries, 'Hut 12') && !entry(r.entries, 'Hut 21') && !entry(r.entries, 'Bess'));
  assert.ok(lines(entry(r.entries, 'Dunn')).includes('Rank: Petty Officer · verified'), lines(entry(r.entries, 'Dunn')).join('\n'));
  assert.ok(!lines(entry(r.entries, 'Hut 12')).some((l) => /red/.test(l)), 'the mug is red, not the hut');
});

test('The Lugger: hair under a short name, a breed by its owner\'s possessive; the notes against the prose asked', async () => {
  const r = await run('dev4/lugger');
  const hair = slipOn(r, 'Tom came down late');
  assert.ok(hair && hair.span === 'dark' && hair.strength === 'strong', JSON.stringify(hair));
  const breed = slipOn(r, 'little Jack Russell');
  assert.ok(breed && breed.span === 'Jack Russell' && /fox terrier/.test(breed.to), JSON.stringify(breed));
  assert.equal(r.slips.length, 2);
  assert.ok(entry(r.entries, 'Tom') === entry(r.entries, 'Thomas Carew'), 'Tom is Thomas Carew');
  assert.ok(!lines(entry(r.entries, 'Nora Hollis')).some((l) => /: eleven ·/.test(l)), 'a number with no noun');
});

test('Tolland\'s: the father\'s bell given to the son by his nickname, the old man\'s eyes, a constable for the sergeant; a round moved is no slip', async () => {
  const r = await run('dev4/tollands');
  const deed = slipOn(r, 'the bell that Young Joss had cast');
  assert.ok(deed && deed.span === 'Young Joss' && deed.to === 'Josiah Tolland Senior', JSON.stringify(deed));
  const eyes = slipOn(r, 'The old man’s blue eyes');
  assert.ok(eyes && eyes.span === 'blue' && eyes.entry === entry(r.entries, 'Josiah Tolland Senior').id, JSON.stringify(eyes));
  const rank = slipOn(r, 'Constable Pryce');
  assert.ok(rank && rank.span === 'Constable' && rank.to === 'Sergeant', JSON.stringify(rank));
  for (const d of ['every morning at nine now', 'Young Joss had blue eyes', 'The boy’s red hair']) assert.ok(!slipOn(r, d) && !lookOn(r, d), d);
  assert.equal(r.slips.length, 3, r.slips.map((s) => s.span).join(', '));
  assert.ok(entry(r.entries, 'Young Joss') === entry(r.entries, 'Josiah Tolland Junior'), 'Young Joss is the boy');
});

test('values of different people never meet: an age beside another\'s, years served beside years left', () => {
  const f = { attr: 'other', label: 'History', value: 'served nineteen years in the navy', as: '' };
  assert.equal(E.clashDetail(f, 'Petty Officer Dunn had served nineteen years in the navy.', 'Dunn had three years left before his pension.', ['Dunn']), null);
  const age = { attr: 'other', label: 'Age', value: 'forty-four', as: '' };
  const c = E.clashDetail(age, 'Dunn was forty-four that winter', 'Dunn was forty-four that winter, and Jo was twenty-six.', ['Dunn']);
  assert.equal(c, null);
});

'use strict';

// The editor's reading (docs/semantics/READING.md) with a fake reader, on the
// dev chapter (scripts/fixtures/canon-editor/dev): the cast and its gates,
// the passage packs, every gate on a dossier's fact (with the hallucinations
// a small model makes: a sentence that isn't there, a claim nobody wrote, a
// fact about someone else, what is only said, a value from a slip's
// sentence), the verifier, the editor's merge and profile, and the slips on
// open facts with their decoys.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const { folderIO } = require('./canon-eval.js');

const E = Canon.Editor;
const DEV = path.join(__dirname, 'fixtures', 'canon-editor', 'dev');
const BOOK = path.join(DEV, 'library', 'book-under-the-line-wh1');
const C1 = Canon.sourceParas(fs.readFileSync(path.join(BOOK, 'chapters', 'c1.html'), 'utf8'));
const CANON = 'canon-the-weighhouse-shelf-wh';

// what a reader proposes (scripts/fixtures/canon-editor/dev/reader-answers.json):
// sentences cited by their words (the fake reader numbers them as the pack
// does), verdicts by "name|value" (none: yes)
const ANSWERS = JSON.parse(fs.readFileSync(path.join(DEV, 'reader-answers.json'), 'utf8'));
const CAST = ANSWERS.cast[0].cast;

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-editor-'));
  const lib = path.join(root, 'library');
  fs.cpSync(path.join(DEV, 'library'), lib, { recursive: true });
  const dir = path.join(lib, CANON);
  let cache = null;
  const io = { ...folderIO(lib, dir), cache: () => cache && structuredClone(cache), saveCache: (c) => { cache = structuredClone(c); } };
  return { root, lib, dir, io, entry: (id) => Canon.parseEntry(fs.readFileSync(path.join(dir, 'entries', id + '.md'), 'utf8')), files: () => fs.readdirSync(path.join(dir, 'entries')), cache: () => cache, clearCache: () => { cache = null; } };
}
const factLines = (e) => e.facts.map((f) => `${Canon.labelOf(f)}: ${f.value}${f.as ? ` (${f.as})` : ''} · ${f.state}`);

test('the cast: names as written, roles written twice, aliases the text ties, the setting; no pronoun, crowd or misspelling', () => {
  const ch = E.chapterModel(C1);
  const cast = E.castGate({ proposals: CAST.map((c) => ({ name: c.n, kind: c.k, aliases: c.a })), setting: 'the Weighhouse', ch, entries: [], names: Canon.shelfNames([ch.text]) });
  const got = Object.fromEntries(cast.map((c) => [c.name, c.aliases]));
  // "His name, Hesper had once heard the warden say, was Anselm": the weigher's name
  assert.deepEqual(got.Anselm, ['the weigher', 'Brother Ink', 'weigher']);
  assert.deepEqual(got['the warden'], ['warden']);
  // a role written once ("the cloth"), a pronoun, a crowd, a name the text doesn't write: no one
  for (const no of ['She', 'the children', 'the cloth', 'the Valey']) assert.equal(got[no], undefined, no);
  // the term the chapter defines in quotation marks: the “Spared”
  assert.ok(cast.some((c) => c.name === 'the Spared' && c.kind === 'group'));
  // "Forty-one" is said, never tied to Hesper as a name: not an alias
  assert.deepEqual(got.Hesper, []);
  // the place the others are in is where the chapter happens
  assert.deepEqual(cast.filter((c) => c.setting).map((c) => c.name), ['the Weighhouse']);
});

test('the packs: a person\'s pronoun sentences, a place\'s paragraph and "the room", nobody else\'s sentences', () => {
  const ch = E.chapterModel(C1);
  const cast = E.castGate({ proposals: CAST.map((c) => ({ name: c.n, kind: c.k, aliases: c.a })), setting: 'the Weighhouse', ch, entries: [], names: Canon.shelfNames([ch.text]) });
  const hits = E.chapterHits(ch, cast);
  const pack = (name) => E.packFor(ch, hits, cast, cast.find((c) => c.name === name), () => null).map((x) => [x.why, x.s.text]);
  const has = (p, words) => p.find(([, t]) => t.includes(words));
  const hesper = pack('Hesper');
  assert.equal(has(hesper, 'Her hair was cropped')[0], 'chain');
  assert.equal(has(hesper, 'She kept her hands still')[0], 'chain');
  assert.ok(!has(hesper, 'She was a narrow woman'), 'the warden\'s sentence');
  const warden = pack('the warden');
  assert.equal(has(warden, 'She was a narrow woman')[0], 'chain');
  assert.ok(!has(warden, 'Her hair was cropped'));
  const room = pack('the Long Room');
  assert.equal(has(room, 'The light came from a strip of yellow lamps')[0], 'para');
  assert.equal(has(room, 'At the far end of the room the door unlocked')[0], 'name'); // "the room"
  assert.ok(!has(room, 'Hesper had been born on the third floor'), 'the room with the green tiles is another room');
  const coll = pack('Coll');
  assert.ok(!has(coll, 'She was a narrow woman') && has(coll, 'He was a head shorter than she was'));
  // the setting: every sentence of narration, none of speech
  const house = pack('the Weighhouse');
  assert.ok(has(house, 'Nobody was allowed slippers before the weighing'));
  assert.ok(!house.some(([, t]) => t === '“Not at you.”'));
});

test('the gates on a dossier fact: cited, grounded, polarity, what is only said; the quote is the writer\'s clause', () => {
  const ch = E.chapterModel(C1);
  const cast = E.castGate({ proposals: CAST.map((c) => ({ name: c.n, kind: c.k, aliases: c.a })), setting: 'the Weighhouse', ch, entries: [], names: Canon.shelfNames([ch.text]) });
  const hits = E.chapterHits(ch, cast);
  const ctx = { ch, text: ch.text, suspect: new Set() };
  const gate = (name, x) => {
    const c = cast.find((y) => y.name === name);
    const part = E.packParts(E.packFor(ch, hits, cast, c, () => null))[0];
    const id = (w) => typeof w === 'number' ? w : (part.lines.find((l) => l.s.text.includes(w)) || { n: 999 }).n;
    return E.gateFact({ x: 0, ...x, s: [].concat(x.s).map(id) }, part, c, ctx);
  };
  assert.equal(gate('Hesper', { g: 'other', a: 'pet', v: 'a tame dragon', s: [99] }).why, 'cited');
  assert.equal(gate('Hesper', { g: 'role', a: 'job', v: 'rides dragons for the king', s: ['The bell went six times'] }).why, 'ungrounded');
  assert.equal(gate('Hesper', { g: 'other', a: 'name', v: 'Hesper Vane', s: ['Hesper was fifteen'] }).why, 'invented');
  assert.equal(gate('Hesper', { g: 'age', a: 'age', v: 'sixteen', s: ['Hesper was fifteen'] }).why, 'invented');
  assert.equal(gate('Coll', { g: 'membership', a: 'caste', v: 'one of the Spared', s: ['He was not one of the Spared'] }).why, 'polarity');
  assert.equal(gate('Coll', { g: 'membership', a: 'caste', v: 'not one of the Spared', s: ['He was not one of the Spared'] }).why, undefined);
  // the narrator's clause, cut from the warden's "too tall" that follows it
  const age = gate('Hesper', { g: 'age', a: 'age', v: 'fifteen', s: ['Hesper was fifteen'] });
  assert.deepEqual([age.quotes, age.said], [['Hesper was fifteen and the tallest girl in her year'], false]);
  const tall = gate('Hesper', { g: 'appearance', a: 'height', v: 'too tall', s: ['Hesper was fifteen'] });
  assert.equal(tall.said, true);
  // Coll's word on the valley is his, whatever the reader marked
  assert.equal(gate('Coll', { g: 'other', a: 'valley', v: 'a town with a mill and too many dogs', s: ['only a town with a mill'] }).said, true);
  // a value from a sentence a slip may stand on
  const slip = gate('Hesper', { g: 'age', a: 'age', v: 'fifteen', s: ['Hesper was fifteen'] });
  ctx.suspect.add(slip.cited[0].s.id);
  assert.equal(gate('Hesper', { g: 'age', a: 'age', v: 'fifteen', s: ['Hesper was fifteen'] }).why, 'suspect');
});

test('Read the Shelf, the editor\'s way: open facts verified by the reader, traits by the gates, a profile every word of which is in its facts', async () => {
  const L = library();
  try {
    const reader = Canon.fakeReader(ANSWERS);
    const phases = [];
    const r = await Canon.createEngine({ io: L.io, reader }).readShelf({ onProgress: (p) => { if (phases[phases.length - 1] !== p.phase) phases.push(p.phase); assert.ok(Number.isFinite(p.eta)); } });
    assert.equal(r.stopped, false);
    // finding who and what is here, reading about each, checking facts, writing profiles
    for (const ph of ['cast', 'dossier', 'verify', 'profile']) assert.ok(phases.includes(ph), ph);
    assert.ok(phases.indexOf('cast') < phases.indexOf('dossier') && phases.indexOf('dossier') < phases.indexOf('verify') && phases.indexOf('verify') < phases.indexOf('profile'));
    const hesper = L.entry('hesper');
    const lines = factLines(hesper);
    for (const want of ['Age: fifteen · verified', 'Height: tallest girl in her year · verified', 'Hair: fair (fair as wet straw) · verified', 'Haircut: cropped close to the skull · verified',
      'Origin: born on the third floor, in the room with the green tiles · verified', 'Sex: female · verified']) assert.ok(lines.includes(want), want + '\n' + lines.join('\n'));
    // the same habit twice is one fact; the warden's "too tall" is hers, never Hesper's truth
    assert.equal(lines.filter((l) => /hands still/.test(l)).length, 1);
    assert.ok(lines.includes('Height: too tall · unverified'));
    // a guess (asked twice: not stated), a dragon, a job nobody wrote, Ch 2's black hair: none of them
    assert.ok(!lines.some((l) => /furious|dragon|king|black/.test(l)), lines.join('\n'));
    // the facts in sections: who they are, then appearance, then habits, then history
    const sections = hesper.facts.map((f) => Canon.factSection(f, 'person'));
    assert.deepEqual(sections, [...sections].sort((a, b) => Canon.SECTIONS.indexOf(a) - Canon.SECTIONS.indexOf(b)));
    // the profile: the princess left out (a word in no fact), every sentence cited, every citation verbatim
    assert.equal(hesper.profile.state, 'note');
    assert.match(hesper.profile.text, /^Hesper is fifteen and the tallest girl in her year \[1\]\. Her hair is fair as wet straw \[2\]\.$/);
    const c1 = C1.map((p) => p.text).join('\n');
    for (const c of hesper.profile.cites) assert.ok(c1.includes(c.quote), c.quote);
    // Coll: not one of the Spared (never the opposite), his hair black, his word on the valley only his
    const coll = factLines(L.entry('coll'));
    assert.ok(coll.includes('Caste: not one of the Spared · verified'), coll.join('\n'));
    assert.ok(!coll.some((l) => /: one of the Spared/.test(l)));
    assert.ok(coll.includes('Hair: black (black hair that stuck up at the crown) · verified'), coll.join('\n'));
    assert.ok(coll.some((l) => /town with a mill.*unverified/.test(l)));
    // the Long Room: what it's like, and Ch 2's "high windows" (a slip's sentence) left out
    const room = factLines(L.entry('long-room'));
    assert.ok(room.includes('Description: not one window · verified') && !room.some((l) => /high windows/.test(l)), room.join('\n'));
    // the weigher is Anselm: one entry, his names as aliases
    const anselm = L.entry('anselm');
    assert.deepEqual(anselm.aliases, ['the weigher', 'Brother Ink', 'weigher']);
    assert.ok(factLines(anselm).includes('Build: thin as a rake · verified'));
    assert.ok(!L.files().includes('weigher.md') && !L.files().includes('she.md') && !L.files().includes('children.md'));
    // the warden is a woman: "She was a narrow woman", her pronoun the warden's by the paragraph
    assert.ok(factLines(L.entry('warden')).includes('Sex: female (woman) · verified'));
    // what was left out, and why, is in this device's cache
    const why = Object.values(L.cache().ed.dropped).flat().map((x) => x.why);
    for (const w of ['cited', 'ungrounded', 'polarity', 'suspect', 'verifier: no']) assert.ok(why.includes(w), w);
    // the reader's answer on "Her" is kept in canon.json, against the sentence
    assert.ok(Object.entries(JSON.parse(fs.readFileSync(path.join(L.dir, 'canon.json'), 'utf8')).refs).some(([k, v]) => k.startsWith('hesper|') && v === true));
  } finally { fs.rmSync(L.root, { recursive: true, force: true }); }
});

test('read again: nothing asked twice, nothing rewritten; another device (no cache) keeps the checked open facts; a chapter changed is read afresh', async () => {
  const L = library();
  try {
    const reader = Canon.fakeReader(ANSWERS);
    await Canon.createEngine({ io: L.io, reader }).readShelf();
    const before = L.files().map((f) => fs.readFileSync(path.join(L.dir, 'entries', f), 'utf8'));
    const calls = reader.calls;
    const again = await Canon.createEngine({ io: L.io, reader }).readShelf();
    assert.equal(again.written, 0);
    assert.equal(reader.calls, calls);
    // another device: no cache, nothing to read; the open facts stay checked
    L.clearCache();
    const other = await Canon.createEngine({ io: L.io, reader: Canon.fakeReader(ANSWERS) }).readShelf();
    assert.equal(other.written, 0);
    assert.deepEqual(L.files().map((f) => fs.readFileSync(path.join(L.dir, 'entries', f), 'utf8')), before);
    // the writer's own fact stays; Ch 1 changed: Canon's facts from it are made afresh
    const hesper = L.entry('hesper');
    hesper.facts.push(Canon.handFact('Habit: counts the wheel squeals'));
    fs.writeFileSync(path.join(L.dir, 'entries', 'hesper.md'), Canon.serialiseEntry(hesper));
    const c1 = path.join(L.lib, 'book-under-the-line-wh1', 'chapters', 'c1.html');
    fs.writeFileSync(c1, fs.readFileSync(c1, 'utf8').replace('Hesper was fifteen and the tallest girl', 'Hesper was sixteen and the tallest girl'));
    await Canon.createEngine({ io: L.io, reader: Canon.fakeReader(ANSWERS) }).readShelf();
    const lines = factLines(L.entry('hesper'));
    assert.ok(lines.includes('Habit: counts the wheel squeals · yours'));
    // (the fake reader still says "fifteen": the sentence no longer does, so nothing gets through)
    assert.ok(!lines.some((l) => /^Age:/.test(l)), lines.join('\n'));
  } finally { fs.rmSync(L.root, { recursive: true, force: true }); }
});

test('the pass on open facts: "high windows" against "not one window" is a slip; the infirmary\'s window, the feast-day bell and Coll\'s flat hair are not', async () => {
  const L = library();
  try {
    const reader = Canon.fakeReader(ANSWERS);
    const engine = Canon.createEngine({ io: L.io, reader });
    await engine.readShelf();
    const { slips, asks } = await engine.check({ scope: 'shelf' });
    const got = slips.map((s) => `${s.kind} ${s.name}: ${s.span}`);
    assert.ok(got.includes('open the Long Room: high windows'), got.join('\n'));
    // Hesper's hair, kept as fair from "Her hair was … fair as wet straw" (the reader said Her is Hesper)
    assert.ok(got.includes('colour Hesper: black'), got.join('\n') + ' / asks: ' + asks.map((s) => s.kind + ' ' + s.span).join());
    for (const decoy of ['infirmary', 'feast', 'His black hair was flat']) assert.ok(!slips.concat(asks).some((s) => s.sentence.includes(decoy)), decoy);
    const open = slips.find((s) => s.kind === 'open');
    assert.deepEqual([open.value, open.as, open.to, open.sources[0].quote], ['not one window', 'Description', null, 'Forty beds ran down the Long Room in two rows, forty girls and boys standing at the foot of them, and not one window between the lot.']);
    // the reader unsure: worth a look; no reader at all: nothing
    const unsure = await Canon.createEngine({ io: L.io, reader: Canon.fakeReader({ ...ANSWERS, clash: [{ sentence: 'Grey light came down', answer: 'unclear' }] }) }).check({ scope: 'shelf' });
    assert.ok(unsure.asks.some((s) => s.kind === 'open' && s.span === 'high windows') && !unsure.slips.some((s) => s.kind === 'open'));
    const none = await Canon.createEngine({ io: L.io, reader: null }).check({ scope: 'shelf' });
    assert.ok(!none.slips.concat(none.asks).some((s) => s.kind === 'open'));
    // Not a slip is remembered against the sentence
    fs.writeFileSync(path.join(L.dir, 'not-slips.json'), JSON.stringify([{ fact: open.fact, sentence: open.sentenceHash }]));
    const dismissed = await engine.check({ scope: 'shelf' });
    assert.ok(!dismissed.slips.some((s) => s.kind === 'open'));
  } finally { fs.rmSync(L.root, { recursive: true, force: true }); }
});

test('clash candidates, by code: a noun said with "no" on one side only, a word against the value, another number', () => {
  const f = (value) => ({ value, as: '' });
  assert.equal(E.clashCandidate(f('not one window'), 'and not one window between the lot', 'Grey light came down through the Long Room’s high windows and lay across the beds.'), 'high windows');
  assert.equal(E.clashCandidate(f('thin as a rake'), 'He was an old man, thin as a rake', 'The stout weigher came in.', ['Anselm', 'the weigher']), 'stout');
  assert.equal(E.clashCandidate(f('forty beds in two rows'), 'Forty beds ran down the Long Room in two rows', 'Thirty beds ran down the Long Room.'), 'Thirty beds');
  // the same, or about something else: nothing to ask
  assert.equal(E.clashCandidate(f('not one window'), 'and not one window between the lot', 'There was still not a window in the Long Room.'), null);
  assert.equal(E.clashCandidate(f('black hair that stuck up at the crown'), 'had black hair that stuck up at the crown', 'His black hair was flat for once; he had slept on it wet.'), null);
  assert.equal(E.clashCandidate(f('the bell goes six times'), 'The bell went six times, the way it always did', 'On feast days it went twelve, but the feast of the Weighing was a long way off yet, and six was what it gave them.'), null);
});

test('the file: a profile round-trips, an edited one is the writer\'s, and an older reader of the file keeps it untouched', () => {
  const text = ['---', 'id: hesper', 'name: Hesper', 'kind: person', 'aliases: []', '---', '# Hesper', '', '## Profile',
    'Hesper is fifteen [1].', '- [1] Under the Line, Ch 1: "Hesper was fifteen" {book:b1, ch:c1}', '', '## Facts', '- Habit: keeps her hands still · verified',
    '  - Under the Line, Ch 1: "She kept her hands still." {book:b1, ch:c1}', '', '## In my words', ''].join('\n');
  const e = Canon.parseEntry(text);
  assert.equal(e.profile.state, 'yours'); // (no Canon's mark: the writer's)
  assert.equal(Canon.serialiseEntry(e), text);
  e.profile.state = 'note';
  const ours = Canon.serialiseEntry(e);
  assert.match(ours, /\n- Canon’s profile \{note:\w+\}\n/);
  assert.equal(Canon.parseEntry(ours).profile.state, 'note');
  assert.equal(Canon.parseEntry(ours.replace('Hesper is fifteen [1].', 'Hesper is fifteen and fierce [1].')).profile.state, 'yours');
  // open labels never read as a trait or a relation
  assert.equal(Canon.openLabel('appearance.hair', 'hair'), 'Hairstyle');
  assert.equal(Canon.openLabel('location.home', 'home'), 'Residence');
  assert.equal(Canon.openLabel('atmosphere', 'smell'), 'Smell');
  assert.equal(Canon.attrOf(Canon.openLabel('state', 'state')), null);
});

test('the reader\'s prompts: a cast, a dossier by sentence numbers, a yes or no, a profile; JSON on one line', async () => {
  const asked = [];
  const reader = Canon.localReader({ id: 'c', tier: 'careful', editor: true, ask: async (m) => {
    asked.push(m);
    if (m.schema === Canon.CAST_SCHEMA) return { c: [{ n: 'Hesper', k: 'person', a: [] }], s: '' };
    if (m.schema === Canon.DOSSIER_SCHEMA) return { f: [{ g: 'age', a: 'age', v: 'fifteen', s: [1], x: 0 }] };
    if (m.schema === Canon.PROFILE_SCHEMA) return { p: [{ t: 'Hesper is fifteen.', f: [1] }] };
    // each passage alone: A has no windows, B has
    return { a: /Sentence: "not one window/.test(m.user) ? 'no' : 'yes' };
  } });
  assert.equal(reader.editor, true);
  assert.deepEqual(await reader.cast({ text: '¶1 Hesper was fifteen.', known: [] }), { cast: [{ name: 'Hesper', kind: 'person', aliases: [] }], setting: '' });
  assert.deepEqual(await reader.dossier({ name: 'Hesper', kind: 'person', aliases: [], text: '[1] Hesper was fifteen.' }), [{ g: 'age', a: 'age', v: 'fifteen', s: [1], x: 0 }]);
  assert.equal(await reader.verify({ name: 'Hesper', label: 'Age', value: 'fifteen', passage: 'Hesper was fifteen.' }), 'yes');
  assert.equal(await reader.clash({ name: 'the Long Room', a: 'not one window', label: 'U, Ch 1', fact: 'Description: no windows', sentence: 'high windows', question: 'does the Long Room have windows?' }), 'yes');
  assert.match(asked[asked.length - 1].user, /^Sentence: "not one window"\nAccording to this sentence, does the Long Room have windows\?$/);
  assert.ok(asked.every((m) => m.compact));
  // the passage first, so a passage asked about twice is read once
  assert.match(asked.find((m) => /Claim about/.test(m.user)).user, /^Passage:\nHesper was fifteen\./);
  // the quick reader isn't asked about clashes (worth a look)
  assert.equal(await Canon.localReader({ id: 'q', tier: 'quick', ask: async () => ({ a: 'yes' }) }).clash({ name: 'x', a: '', label: '', fact: '', sentence: '' }), 'unasked');
});

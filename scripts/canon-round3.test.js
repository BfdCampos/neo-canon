'use strict';

// Round 3 (READING.md §13): the code around the reader, measured with
// readers made from the answer sheets (scripts/canon-perfect.js) on dev,
// dev2 and the in-app QA's own chapter (scripts/fixtures/canon-editor/qa):
//
//   packs        a sentence belongs to everyone it is about — by name, by a
//                pronoun the reading resolves, by the paragraph a place opens
//   perfect      a reader that proposes every sheet fact its pack holds, and
//                answers as the sheet would: the gates keep ≥ 95% of them
//   adversarial  a reader that also files others' facts under each entity and
//                believes them: the gates keep ≤ 5% of those
//   QA's cases   "Height: long", a horse's age on her rider, the place with
//                no facts, the Guild twice, the slips the pass missed

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');
const P = require('./canon-perfect.js');
const { folderIO } = require('./canon-eval.js');

const E = Canon.Editor;
const FIX = path.join(__dirname, 'fixtures', 'canon-editor');
const QA = path.join(FIX, 'qa');
const N = (s) => Canon.norm(s);
const lines = (e) => e.facts.map((f) => `${Canon.labelOf(f)}: ${f.value} · ${f.state}`);

// every fixture read once by each sheet reader (shared by the tests below)
let runs = null;
async function allRuns() {
  if (runs) return runs;
  runs = [];
  for (const fx of P.FIXTURES) {
    const name = path.relative(FIX, fx);
    const setting = P.SETTINGS[name] || '';
    runs.push({ name, perfect: await P.runSheet(fx, { setting }), adversary: await P.runSheet(fx, { mode: 'adversarial', setting }) });
  }
  return runs;
}

// a library in a temporary folder made from a fixture's, read with a reader
async function readWith(libDir, reader) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-r3-'));
  const lib = path.join(root, 'library');
  fs.cpSync(libDir, lib, { recursive: true });
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  const dir = path.join(lib, library.shelves[0].canonId);
  let cache = null;
  const io = { ...folderIO(lib, dir), cache: () => cache && structuredClone(cache), saveCache: (c) => { cache = structuredClone(c); } };
  const engine = Canon.createEngine({ io, reader });
  await engine.readShelf({});
  const checked = await engine.check({ scope: 'shelf' });
  const entries = io.entries().map((x) => Canon.parseEntry(x.text));
  fs.rmSync(root, { recursive: true, force: true });
  return { entries, ...checked, cache };
}
const entry = (entries, name) => entries.find((e) => [e.name, ...e.aliases].some((n) => N(n) === N(name)));

// QA's chapter, cast as QA's own fake reader gives it
function qaChapter(ch = 'c1') {
  const html = fs.readFileSync(path.join(QA, 'library', 'book-the-lamplighter-qa1', 'chapters', ch + '.html'), 'utf8');
  const c = E.chapterModel(Canon.sourceParas(html));
  const A = JSON.parse(fs.readFileSync(path.join(QA, 'reader-answers.json'), 'utf8'));
  const cast = E.castGate({ proposals: A.cast[0].cast.map((x) => ({ name: x.n, kind: x.k, aliases: x.a })), setting: '', ch: c, entries: [], names: Canon.shelfNames([c.text]) });
  cast.forEach((x, i) => { x.key = i; });
  const hits = E.chapterHits(c, cast);
  E.resolveRefs(c, hits, cast, () => null);
  const pack = (name) => E.packFor(c, hits, cast, cast.find((x) => x.name === name), () => null).map((x) => [x.why, x.s.text]);
  return { ch: c, cast, hits, pack };
}

test('packs: every sentence about it — a place\'s whole description, a lead\'s possessive, a boy\'s introduction after his line', () => {
  const { pack, cast } = qaChapter();
  const has = (p, words) => p.find(([, t]) => t.startsWith(words));
  // the Lantern House: the paragraph it opens is its own, though Dunmere is named in it
  const house = pack('the Lantern House');
  for (const s of ['The Lantern House stood at the end', 'Its windows faced east', 'Inside it was always cold.', 'The air smelled of lamp oil']) assert.ok(has(house, s), s);
  assert.ok(!has(house, 'She was thirty-four'), 'Mara\'s sentence is not the house\'s');
  assert.ok(!has(pack('Dunmere'), 'Inside it was always cold.'));
  // "the tower" is the Lantern House, by its own description
  assert.ok(has(house, 'The lamp-room was the warmest place in the tower.'));
  // Mara: "A white scar ran through her left eyebrow" (a possessive, no subject pronoun)
  assert.equal(has(pack('Mara Venn'), 'A white scar ran through')[0], 'chain');
  // Tobias: his introduction follows the line he says; "her" there is Mara's
  const tobias = pack('Tobias');
  assert.equal(has(tobias, 'He was a thin boy of fourteen')[0], 'chain');
  assert.ok(has(pack('Mara Venn'), 'He was a thin boy of fourteen'), 'her apprentice: Mara\'s too');
  // "Her name was Ines Garrow": the woman from the Guild is Ines
  assert.ok(has(pack('Ines Garrow'), 'She looked up at the Lantern House'));
  // the Guild and "the Guild" are one
  assert.equal(cast.filter((c) => /Guild/.test(c.name)).length, 1, cast.map((c) => c.name).join(', '));
});

test('pronouns as a reader reads them: the last sentence\'s subject, not the name in its "than"; an object never its own clause\'s subject', () => {
  // the Tutorial's story, as QA's fake reader casts it: "She was fourteen" is Juniper's, not Wren's
  const html = fs.readFileSync(path.join(__dirname, '..', 'tutorial', 'story', 'chapters', 'c1.html'), 'utf8');
  const ch = E.chapterModel(Canon.sourceParas(html));
  const A = JSON.parse(fs.readFileSync(path.join(QA, 'tutorial-reader-answers.json'), 'utf8'));
  const cast = E.castGate({ proposals: A.cast[0].cast.map((x) => ({ name: x.n, kind: x.k, aliases: x.a })), setting: '', ch, entries: [], names: Canon.shelfNames([ch.text]) });
  cast.forEach((x, i) => { x.key = i; });
  const hits = E.chapterHits(ch, cast);
  const refs = E.resolveRefs(ch, hits, cast, () => null);
  const s = ch.sents.find((x) => x.text.startsWith('She was fourteen'));
  const juniper = cast.find((c) => c.name === 'Juniper');
  const wren = cast.find((c) => c.name === 'Wren Calloway');
  assert.ok(refs.get(s.id).keys.has(juniper.key));
  assert.ok(!refs.get(s.id).keys.has(wren.key) && !refs.get(s.id).weak.has(wren.key));
  // "He belonged to Hesketh": the gelding, the sentence's subject before
  const b = ch.sents.find((x) => x.text.startsWith('He belonged to Hesketh'));
  assert.ok(refs.get(b.id).keys.has(cast.find((c) => c.name === 'Ballast').key));
  // QA's chapter: "said Tobias, coming down to meet her" — her is Mara
  const q = qaChapter();
  const t = q.ch.sents.find((x) => x.text.includes('coming down to meet her'));
  const p = q.ch.paras[t.pi];
  const at = p.text.indexOf('meet her') + 5;
  assert.equal(q.cast.find((c) => c.key === p.refs.get(at).key).name, 'Mara Venn');
});

test('pack coverage: the sheets\' quotes reach the right entity\'s pack (dev, dev2, QA\'s chapter)', async () => {
  let must = { in: 0, of: 0 };
  let all = { in: 0, of: 0 };
  for (const r of await allRuns()) {
    const m = P.packCoverage(r.perfect, { weights: ['must'] });
    const a = P.packCoverage(r.perfect, { weights: ['must', 'should', 'nice'] });
    must = { in: must.in + m.in, of: must.of + m.of };
    all = { in: all.in + a.in, of: all.of + a.of };
    if (r.name === 'qa') assert.equal(m.in, m.of, m.missing.join('\n'));
  }
  assert.ok(must.in / must.of >= 0.95, `must ${must.in}/${must.of}`);
  assert.ok(all.in / all.of >= 0.9, `all ${all.in}/${all.of}`);
});

test('a perfect reader: the gates keep ≥ 95% of the sheet facts it proposes, and nothing wrong', async () => {
  let kept = 0;
  let of = 0;
  const lost = [];
  for (const r of await allRuns()) {
    const sv = P.survival(r.perfect);
    kept += sv.proposed.kept;
    of += sv.proposed.of;
    lost.push(...sv.lost.filter((l) => !/not proposed/.test(l)).map((l) => r.name + ': ' + l));
    assert.deepEqual(r.perfect.score.precision.wrong, [], r.name);
  }
  assert.ok(kept / of >= 0.95, `${kept}/${of}\n${lost.join('\n')}`);
  // QA's chapter: the place that had no facts, the boy who had none
  const qa = (await allRuns()).find((r) => r.name === 'qa').perfect.entries;
  assert.ok(entry(qa, 'the Lantern House').facts.filter((f) => f.state === 'verified').length >= 8, lines(entry(qa, 'the Lantern House')).join('\n'));
  const tobias = lines(entry(qa, 'Tobias'));
  for (const want of ['Sex: male · verified', 'Age: fourteen · verified', 'Build: thin · verified', 'Hair: red · verified']) assert.ok(tobias.includes(want), want + '\n' + tobias.join('\n'));
  assert.ok(lines(entry(qa, 'Mara Venn')).some((l) => /^Marks?: a white scar/.test(l)), lines(entry(qa, 'Mara Venn')).join('\n'));
});

test('an adversarial reader: others\' facts filed under each entity, believed — the gates keep ≤ 5%', async () => {
  let kept = 0;
  let of = 0;
  const got = [];
  for (const r of await allRuns()) {
    const bad = P.survivors(r.adversary);
    kept += bad.length;
    of += r.adversary.log.filter((x) => x.wrong).length;
    got.push(...bad.map((b) => r.name + ': ' + b));
  }
  assert.ok(of > 200, 'the adversary proposed ' + of);
  assert.ok(kept / of <= 0.05, `${kept}/${of}\n${got.join('\n')}`);
  // dev2 alone (the round-2 failure types): ≤ 5% too
  const dev2 = (await allRuns()).filter((r) => r.name.startsWith('dev2/'));
  const k2 = dev2.reduce((n, r) => n + P.survivors(r.adversary).length, 0);
  const o2 = dev2.reduce((n, r) => n + r.adversary.log.filter((x) => x.wrong).length, 0);
  assert.ok(k2 / o2 <= 0.05, `dev2 ${k2}/${o2}`);
});

test('QA\'s own reader on QA\'s chapter: no height from "a long while", no moment for a trait, the house described, one Guild', async () => {
  const reader = Canon.fakeReader(JSON.parse(fs.readFileSync(path.join(QA, 'reader-answers.json'), 'utf8')));
  const { entries } = await readWith(path.join(QA, 'library'), reader);
  const tobias = lines(entry(entries, 'Tobias'));
  assert.ok(!tobias.some((l) => /Height: long|Personality: quiet/.test(l)), tobias.join('\n'));
  assert.ok(tobias.includes('Age: fourteen · verified'), tobias.join('\n'));
  assert.ok(entry(entries, 'the Lantern House').facts.filter((f) => f.state === 'verified').length >= 6, lines(entry(entries, 'the Lantern House')).join('\n'));
  assert.equal(entries.filter((e) => /Guild/.test(e.name)).length, 1, entries.map((e) => e.name).join(', '));
  // "Coldharbour has no lamps," she said: only said, never true
  const cold = entry(entries, 'Coldharbour');
  assert.ok(!cold || !cold.facts.some((f) => /no lamps/.test(f.value) && f.state === 'verified'));
});

test('the Tutorial\'s story with QA\'s reader: the mare\'s age and build are hers, never Wren\'s', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-r3-tut-'));
  try {
    const lib = path.join(root, 'lib');
    fs.mkdirSync(path.join(lib, 'canon-tut-shelf-t', 'entries'), { recursive: true });
    fs.mkdirSync(path.join(lib, 'canon-tut-shelf-t', 'set-aside'), { recursive: true });
    fs.cpSync(path.join(__dirname, '..', 'tutorial', 'story'), path.join(lib, 'book-story-t'), { recursive: true });
    const meta = JSON.parse(fs.readFileSync(path.join(lib, 'book-story-t', 'book.json'), 'utf8'));
    fs.writeFileSync(path.join(lib, 'book-story-t', 'book.json'), JSON.stringify({ ...meta, id: 'book-story-t' }));
    fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({ shelves: [{ id: 'shelf-t', name: 'Tutorial', bookIds: ['book-story-t'], canonId: 'canon-tut-shelf-t' }] }));
    fs.writeFileSync(path.join(lib, 'canon-tut-shelf-t', 'canon.json'), JSON.stringify({ v: 1, shelfId: 'shelf-t', read: {}, settings: {} }));
    fs.writeFileSync(path.join(lib, 'canon-tut-shelf-t', 'not-slips.json'), '[]');
    const reader = Canon.fakeReader(JSON.parse(fs.readFileSync(path.join(QA, 'tutorial-reader-answers.json'), 'utf8')));
    const { entries } = await readWith(lib, reader);
    const wren = lines(entry(entries, 'Wren Calloway'));
    assert.ok(!wren.some((l) => /^(?:Age: fourteen|Build: broad|Height: short)/.test(l)), wren.join('\n'));
    assert.ok(lines(entry(entries, 'Juniper')).some((l) => /^Age: fourteen · verified/.test(l)), lines(entry(entries, 'Juniper')).join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the pass on QA\'s chapter: brown eyes against grey, "He rubbed her eyes" for a boy, nine floors against eleven; nothing false', async () => {
  const r = (await allRuns()).find((x) => x.name === 'qa').perfect;
  const spans = r.slips.map((s) => `${s.name}: ${s.span}`);
  for (const want of ['Mara Venn: brown', 'Tobias: her', 'the Lantern House: nine floors']) assert.ok(spans.includes(want), want + '\n' + spans.join('\n'));
  assert.deepEqual(r.score.slips.false || [], []);
  // and every fixture: no false slip
  for (const x of await allRuns()) assert.deepEqual(x.perfect.score.slips ? x.perfect.score.slips.false : [], [], x.name);
});

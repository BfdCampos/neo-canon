'use strict';

// Canon on the Ashfall Road fixture (scripts/fixtures/canon): the Continuity
// Pass and Read the Shelf, with the fake reader and the real en-US dictionary.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Canon = require('../canon.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
const ANSWERS = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'reader-answers.json'), 'utf8'));
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
const CANON = 'canon-the-ashfall-road-shelf-ash';
const SALT = 'book-the-salt-crown-salt2';

// the spelling dictionary NEO ships, straight from Hunspell's WebAssembly
let hunspell = null;
async function knownWords(words) {
  if (!hunspell) {
    const { loadModule } = require('@farscrl/hunspell-wasm');
    const factory = await loadModule();
    const dir = path.join(__dirname, '..', 'node_modules', 'dictionary-en-gb');
    hunspell = factory.create(factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.aff')), 'gb.aff'), factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.dic')), 'gb.dic'));
  }
  return Object.fromEntries(words.map((w) => [w, hunspell.spell(w)]));
}

// what main.js reads for a shelf, from a library folder: chapters in shelf
// order, a book's Notes after its chapters, a notebook's pages by their titles
function shelfSources(lib) {
  const library = JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'));
  const out = [];
  for (const bookId of library.shelves[0].bookIds) {
    const meta = JSON.parse(fs.readFileSync(path.join(lib, bookId, 'book.json'), 'utf8'));
    const notebook = meta.format === 'notebook';
    meta.chapterOrder.forEach((chId, i) => out.push({ bookId, chId, book: meta.title,
      label: notebook ? meta.chapterTitles[chId] : 'Ch ' + (i + 1), notebook, html: fs.readFileSync(path.join(lib, bookId, 'chapters', chId + '.html'), 'utf8') }));
    if (!notebook) out.push({ bookId, chId: 'notes', book: meta.title, label: 'Notes', notes: true, html: fs.readFileSync(path.join(lib, bookId, 'notes.html'), 'utf8') });
  }
  return out;
}

// expected.json's entries, every fact the writer's own
function handKept() {
  return EXPECTED.entries.map((x) => {
    const e = Canon.newEntry(x.name, x.kind, x.id);
    for (const f of x.facts) if (!f.said && !f.plan) e.facts.push({ attr: f.attr, value: f.value, as: f.as || '', state: 'yours', sources: [{ written: true }] });
    return e;
  });
}

const notSlips = () => JSON.parse(fs.readFileSync(path.join(FIXTURE, 'library', CANON, 'not-slips.json'), 'utf8'));
const pick = (s) => ({ chapter: s.chId, sentence: s.sentence, span: s.span, to: s.to, entry: s.entry, attr: s.attr, strength: s.strength });
// (kept by hand there is no story so far: the deed given to Ilsa needs the reader's key points)
const TRAIT_SLIPS = EXPECTED.slips.filter((s) => s.attr !== 'event');

test('Continuity Pass, kept by hand with no reader: the three strong slips in The Salt Crown, the two weak ones worth a look', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => s.bookId === SALT && !s.notes);
  const { slips, asks } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords });
  assert.deepEqual(slips.map(pick), TRAIT_SLIPS.filter((s) => s.strength === 'strong'));
  // the two weak ones, which the reader would confirm, are worth a look; no decoy is
  assert.deepEqual(asks.map(pick), TRAIT_SLIPS.filter((s) => s.strength === 'weak'));
});

test('Continuity Pass with the reader: exactly the five seeded slips, no decoy', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => s.bookId === SALT && !s.notes);
  const seen = [];
  const { slips, facts } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords,
    reader: Canon.fakeReader(ANSWERS), onSource: (src, found, n, of) => seen.push([src.chId, found.length, n, of]) });
  assert.deepEqual(slips.map(pick), TRAIT_SLIPS);
  assert.deepEqual(seen, [['c1', 2, 1, 3], ['c2', 2, 2, 3], ['c3', 1, 3, 3]]);
  assert.equal(facts, 10); // the ones that can raise slips: no titles, owners or states
  for (const decoy of EXPECTED.decoys) assert.ok(!slips.some((s) => s.sentence === decoy), decoy);
  // each mark sits on its word in the writer's own text
  for (const s of slips) {
    const p = Canon.sourceParas(sources.find((x) => x.chId === s.chId).html).find((x) => x.hash === s.para);
    assert.equal(p.text.slice(s.at, s.at + s.span.length), s.span);
  }
});

test('the whole shelf: Book 1, the notebook and the decoys stay clean', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => !s.notes && !(s.bookId === 'book-field-notes-notes3' && s.chId === 'p3'));
  const { slips } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords, reader: Canon.fakeReader(ANSWERS) });
  assert.deepEqual(slips.map((s) => s.bookId), Array(5).fill(SALT));
});

test('the dismissed firelight line comes back once its sentence is edited', async () => {
  const sources = shelfSources(path.join(FIXTURE, 'library')).filter((s) => s.bookId === SALT && s.chId === 'c3');
  sources[0].html = sources[0].html.replace('almost brown in the firelight', 'almost brown in the lamplight');
  const { slips } = await Canon.checkSources({ sources, entries: handKept(), notSlips: notSlips(), knownWords });
  assert.deepEqual(slips.map((s) => [s.span, s.to, s.fact]), [['brown', 'grey', 'ilsa-varr/eyes']]);
});

/* ---------- Read the Shelf ---------- */

// a temporary copy of the fixture library, and the engine's way to its files
function copyLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-fixture-'));
  const lib = path.join(root, 'library');
  fs.cpSync(path.join(FIXTURE, 'library'), lib, { recursive: true });
  return { root, lib, dir: path.join(lib, CANON), cacheFile: path.join(root, 'canon-cache', 'index.json') };
}
function folderIO({ lib, dir, cacheFile }) {
  const json = (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback;
  const writes = [];
  return {
    writes,
    sources: () => shelfSources(lib),
    meta: () => json(path.join(dir, 'canon.json'), {}),
    saveMeta: (m) => { writes.push('canon.json'); fs.writeFileSync(path.join(dir, 'canon.json'), JSON.stringify(m, null, 2)); },
    entries: () => fs.readdirSync(path.join(dir, 'entries')).filter((f) => f.endsWith('.md')).map((f) => ({ id: f.slice(0, -3), text: fs.readFileSync(path.join(dir, 'entries', f), 'utf8') })),
    saveEntry: (id, text) => { writes.push(id); fs.writeFileSync(path.join(dir, 'entries', id + '.md'), text); },
    notSlips: () => json(path.join(dir, 'not-slips.json'), []),
    cache: () => json(cacheFile, null),
    saveCache: (c) => { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(c)); },
    knownWords
  };
}
const entryFiles = (dir) => Object.fromEntries(fs.readdirSync(path.join(dir, 'entries')).filter((f) => f.endsWith('.md')).sort().map((f) => [f, fs.readFileSync(path.join(dir, 'entries', f), 'utf8')]));
const readEntries = (dir) => Object.values(entryFiles(dir)).map(Canon.parseEntry);

async function readOnce() {
  const where = copyLibrary();
  const io = folderIO(where);
  const reader = Canon.fakeReader(ANSWERS);
  const summary = await Canon.createEngine({ io, reader }).readShelf();
  return { ...where, io, reader, summary };
}

test('Read the Shelf gives the expected entries and facts, each quote the writer\'s own words', async () => {
  const { dir, lib, root, summary } = await readOnce();
  try {
    const got = readEntries(dir);
    assert.deepEqual(got.map((e) => [e.id, e.name, e.kind]).sort(), EXPECTED.entries.map((e) => [e.id, e.name, e.kind]).sort());
    for (const x of EXPECTED.entries) {
      const e = got.find((g) => g.id === x.id);
      const facts = e.facts.map((f) => ({ attr: f.attr, value: f.value, ...(f.as ? { as: f.as } : {}), state: f.state,
        ...(f.sources.every((s) => s.said) ? { said: true } : {}), ...(f.sources.every((s) => s.plan) ? { plan: true } : {}),
        chapters: f.sources.map((s) => s.book + '/' + s.ch) }));
      assert.deepEqual(facts, x.facts.map((f) => ({ ...f })), x.id);
    }
    // P0 #6: every model-made fact's quote is verbatim in its chapter
    const texts = new Map(shelfSources(lib).map((s) => [s.bookId + '/' + s.chId, Canon.sourceParas(s.html).map((p) => p.text).join('\n')]));
    for (const e of got) for (const f of e.facts) for (const s of f.sources) assert.ok(texts.get(s.book + '/' + s.ch).includes(s.quote), s.quote);
    assert.equal(got.find((e) => e.id === 'bramble').facts.find((f) => f.attr === 'sex' && f.value === 'male').sources[0].said, 'the horse-trader');
    // (the trader's gelding and the foal question wait for the writer;
    // Bramble's "Tamsin rode her" got through no gate, so it's left out. Oren
    // is male by the narration's own he, in three sentences and against none)
    assert.deepEqual(summary, { entries: 7, facts: 16, written: 7, calls: summary.calls, stopped: false, verified: 14, needs: 2 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the story so far: the key points the gates let through, in reading order, as Canon\'s notes; the rest left out', async () => {
  const { dir, root, cacheFile } = await readOnce();
  try {
    const got = readEntries(dir);
    for (const [id, lines] of Object.entries(EXPECTED.story)) assert.deepEqual(got.find((e) => e.id === id).story.map((x) => x.did), lines, id);
    assert.ok(got.every((e) => e.story.every((x) => x.state === 'note' && x.sources.length === 1)));
    assert.deepEqual(got.filter((e) => !EXPECTED.story[e.id]).flatMap((e) => e.story), []);
    // left out, with why: a who the quote doesn't name, a word nobody wrote
    const lost = Object.values(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).lostEvents).map((x) => x.why).sort();
    assert.deepEqual(lost, ['invented', 'who']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('what the gates keep out: misquotes, values not in their quote, the Maybe page, Darlings and stickies', async () => {
  const { dir, root } = await readOnce();
  try {
    const all = Object.values(entryFiles(dir)).join('\n');
    assert.ok(!all.includes('grey as slate'));      // misquoted
    assert.ok(!/Rook[\s\S]*Sex: female/.test(entryFiles(dir)['rook.md']));  // a value its quote doesn't hold
    assert.ok(!all.includes('green') && !all.includes('What if'));            // left out of Canon
    assert.ok(!all.includes('a bad one') && !all.includes('Check.'));         // Darlings and stickies are never read
    assert.equal((all.match(/gelding/g) || []).length, 2);                    // only the trader's line, said, in speech
    assert.match(entryFiles(dir)['bramble.md'], /- State: in foal · unverified\n {2}- The Salt Crown, Notes: "Bramble is in foal by the end of book 2\?" \{book:book-the-salt-crown-salt2, ch:notes, plan\}/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the Continuity Pass against what Read the Shelf found: the five slips, no decoy', async () => {
  const { root, io, reader } = await readOnce();
  try {
    const { slips } = await Canon.createEngine({ io, reader }).check({ bookId: SALT });
    assert.deepEqual(slips.map(pick), EXPECTED.slips);
    assert.equal(slips[0].sources[0].quote, 'Bramble, the grey mare, would not cross the ford.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reading again: nothing changed, nothing asked, nothing written; one paragraph edited, one call', async () => {
  const { root, lib, dir, io, cacheFile } = await readOnce();
  try {
    const files = entryFiles(dir);
    io.writes.length = 0;
    const reader = Canon.fakeReader(ANSWERS);
    const again = await Canon.createEngine({ io, reader }).readShelf();
    assert.equal(again.calls, 0);
    assert.deepEqual(io.writes, []); // P1 #20
    // the cache is this device's and rebuildable: gone, no entry changes (P1 #21)
    fs.rmSync(cacheFile);
    await Canon.createEngine({ io, reader }).readShelf();
    await Canon.createEngine({ io, reader }).readShelf({ again: true });
    assert.deepEqual(entryFiles(dir), files);
    assert.deepEqual(io.writes, []);
    // the last paragraph of a chapter edited: that context alone is asked (its facts and its key points)
    const c3 = path.join(lib, 'book-ember-and-thorn-ember1', 'chapters', 'c3.html');
    fs.writeFileSync(c3, fs.readFileSync(c3, 'utf8').replace('the useless one', 'the useless one, and Rook agreed'));
    const one = Canon.fakeReader(ANSWERS);
    assert.equal((await Canon.createEngine({ io, reader: one }).readShelf()).calls, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the writer\'s facts survive Read Everything Again; a passage edited away is marked changed (P1 #17, #19)', async () => {
  const { root, lib, dir, io } = await readOnce();
  try {
    const file = path.join(dir, 'entries', 'bramble.md');
    const e = Canon.parseEntry(fs.readFileSync(file, 'utf8'));
    e.facts.push(Canon.handFact('Hair: grey'));
    fs.writeFileSync(file, Canon.serialiseEntry(e));
    const c1 = path.join(lib, 'book-ember-and-thorn-ember1', 'chapters', 'c1.html');
    fs.writeFileSync(c1, fs.readFileSync(c1, 'utf8').replace('was the only woman on the wall', 'was the only soldier on the wall'));
    await Canon.createEngine({ io, reader: Canon.fakeReader(ANSWERS) }).readShelf({ again: true });
    const after = Canon.parseEntry(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(after.facts.find((f) => f.attr === 'hair'), { attr: 'hair', label: undefined, value: 'grey', as: '', state: 'yours', sources: [{ written: true }] });
    const ilsa = path.join(dir, 'entries', 'ilsa-varr.md');
    const sex = Canon.parseEntry(fs.readFileSync(ilsa, 'utf8')).facts.find((f) => f.attr === 'sex');
    assert.equal(sex.state, 'unverified');
    assert.equal(sex.sources[0].changed, true);
    assert.match(fs.readFileSync(ilsa, 'utf8'), /\{book:book-ember-and-thorn-ember1, ch:c1, changed\}/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Not right is remembered: the same value from the same quote is not proposed again', async () => {
  const { root, dir, io } = await readOnce();
  try {
    const file = path.join(dir, 'entries', 'rook.md');
    const e = Canon.parseEntry(fs.readFileSync(file, 'utf8'));
    Canon.setAsideFact(e, e.facts.findIndex((f) => f.attr === 'owner'), true);
    fs.writeFileSync(file, Canon.serialiseEntry(e));
    await Canon.createEngine({ io, reader: Canon.fakeReader(ANSWERS) }).readShelf({ again: true });
    const after = Canon.parseEntry(fs.readFileSync(file, 'utf8'));
    assert.equal(after.facts.some((f) => f.attr === 'owner'), false);
    assert.equal(after.setAside.find((f) => f.attr === 'owner').state, 'not right');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('first said, first kept: a later reading that contradicts the fact is the pass\'s slip, never a question', async () => {
  // a reader that also takes the slips at their word, as a small model does
  const answers = structuredClone(ANSWERS);
  answers.propose.unshift(
    { para: 'Bramble did not like the convoy', facts: [{ entity: 'Bramble', kind: 'creature', attr: 'sex', value: 'male', quote: 'Bramble tossed his head' }] },
    { para: 'Ilsa rode back along the line', facts: [{ entity: 'Ilsa Varr', kind: 'person', attr: 'eyes', value: 'brown', quote: 'Ilsa’s brown eyes narrowed.' }] });
  const where = copyLibrary();
  const io = folderIO(where);
  try {
    const check = async () => (await Canon.createEngine({ io, reader: Canon.fakeReader(answers) }).check({ bookId: SALT })).slips.map(pick);
    const states = () => {
      const got = readEntries(where.dir);
      const of = (id, attr) => got.find((e) => e.id === id).facts.filter((f) => f.attr === attr && !f.sources.every((s) => s.said)).map((f) => f.value + ' ' + f.state).sort();
      return [of('bramble', 'sex'), of('ilsa-varr', 'eyes')];
    };
    // all in one first read: what was said first is kept; the later word is no fact
    const first = await Canon.createEngine({ io, reader: Canon.fakeReader(answers) }).readShelf();
    assert.deepEqual(states(), [['female verified'], ['grey verified']]);
    // only the foal question and the trader's gelding wait for the writer
    assert.equal(first.needs, 2);
    assert.deepEqual(await check(), EXPECTED.slips);
    // and read again with the facts already checked: nothing moves
    await Canon.createEngine({ io, reader: Canon.fakeReader(answers) }).readShelf({ again: true });
    assert.deepEqual(states(), [['female verified'], ['grey verified']]);
    assert.deepEqual(await check(), EXPECTED.slips);
  } finally { fs.rmSync(where.root, { recursive: true, force: true }); }
});

test('the writer\'s notes against the prose: "Which is right?", both sources, no slip until the writer picks', async () => {
  const where = copyLibrary();
  const io = folderIO(where);
  try {
    // the House Varr page says brown; Book 1 says grey first
    const page = path.join(where.lib, 'book-field-notes-notes3', 'chapters', 'p2.html');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('grey eyes', 'brown eyes'));
    const answers = structuredClone(ANSWERS);
    for (const x of answers.propose) for (const f of x.facts) if (f.quote.includes('Ilsa: grey eyes')) { f.quote = f.quote.replace('grey', 'brown'); if (f.attr === 'eyes') f.value = 'brown'; }
    for (const x of answers.propose) if (x.para.startsWith('Ilsa: grey')) x.para = x.para.replace('grey', 'brown');
    const r = await Canon.createEngine({ io, reader: Canon.fakeReader(answers) }).readShelf();
    const ilsa = () => readEntries(where.dir).find((e) => e.id === 'ilsa-varr');
    assert.deepEqual(ilsa().facts.filter((f) => f.attr === 'eyes').map((f) => `${f.value} ${f.state} ${f.sources.map((s) => s.ch).join('+')}`).sort(), ['brown disagree p2', 'grey disagree c1']);
    assert.equal(r.needs, 3); // (one Which is right? for the eyes, as the pane lists it: round 3)
    const slips = await Canon.createEngine({ io, reader: Canon.fakeReader(answers) }).check({ bookId: SALT });
    assert.ok(!slips.slips.some((s) => s.attr === 'eyes'));
    // the writer picks grey: it's theirs, brown steps aside, and the slip is back
    const file = path.join(where.dir, 'entries', 'ilsa-varr.md');
    const e = ilsa();
    Canon.confirmFact(e, e.facts.findIndex((f) => f.attr === 'eyes' && f.value === 'grey'));
    fs.writeFileSync(file, Canon.serialiseEntry(e));
    const again = await Canon.createEngine({ io, reader: Canon.fakeReader(answers) }).check({ bookId: SALT });
    assert.ok(again.slips.some((s) => s.attr === 'eyes' && s.span === 'brown'));
  } finally { fs.rmSync(where.root, { recursive: true, force: true }); }
});

test('what a small reader gets wrong stays out: unnamed things, values that aren\'t names, a coat for hair', async () => {
  const answers = structuredClone(ANSWERS);
  const ford = answers.propose.find((x) => x.para === 'The ford below Corwick');
  ford.facts.push(
    { entity: 'the ford', kind: 'place', attr: 'home', value: 'Corwick', quote: 'The ford below Corwick' },
    { entity: 'Bramble', kind: 'creature', attr: 'home', value: 'below Corwick', quote: 'The ford below Corwick' },
    { entity: 'Bramble', kind: 'creature', attr: 'hair', value: 'grey', quote: 'Bramble, the grey mare' });
  answers.propose.find((x) => x.para === 'Bramble — mare, eleven').facts.push({ entity: 'Bramble', kind: 'creature', attr: 'birthplace', value: 'eleven', quote: 'Bramble — mare, eleven' });
  const where = copyLibrary();
  try {
    await Canon.createEngine({ io: folderIO(where), reader: Canon.fakeReader(answers) }).readShelf();
    const files = entryFiles(where.dir);
    assert.ok(!Object.keys(files).some((f) => /ford/.test(f)));
    assert.doesNotMatch(files['bramble.md'], /Lives in|Hair|Born in/);
  } finally { fs.rmSync(where.root, { recursive: true, force: true }); }
});

/* ---------- changing a fact across the series (M9) ---------- */

test('Bramble is now a stallion: the passages that say mare, in reading order, and what needs the writer\'s words', async () => {
  const { root, dir, lib, io, reader } = await readOnce();
  try {
    const file = path.join(dir, 'entries', 'bramble.md');
    const e = Canon.parseEntry(fs.readFileSync(file, 'utf8'));
    Canon.replaceFact(e, Canon.handFact('Sex: stallion'), null);
    fs.writeFileSync(file, Canon.serialiseEntry(e));
    assert.match(fs.readFileSync(file, 'utf8'), /## Set aside\n- Sex: female \(mare\) · set aside\n {2}- Ember and Thorn, Ch 2/);
    const items = await Canon.createEngine({ io, reader }).passages({ entryId: 'bramble', attr: 'sex' });
    assert.deepEqual(items.map((x) => [x.book + ', ' + x.label, x.span, x.to]), [
      ['Ember and Thorn, Ch 2', 'mare', 'stallion'],
      ['Ember and Thorn, Ch 2', 'her', 'his'],
      ['The Salt Crown, Ch 1', 'her', 'his'],
      ['The Salt Crown, Notes', 'in foal', null],
      ['Field Notes, Horses', 'mare', 'stallion']
    ]);
    // the swap, made in the chapter's own HTML, changes that word and nothing else
    const [first] = items;
    const ch = path.join(lib, 'book-ember-and-thorn-ember1', 'chapters', 'c2.html');
    const html = fs.readFileSync(ch, 'utf8');
    const next = Canon.replaceInHtml(html, first.para, first.at, first.span, first.to);
    assert.equal(next, html.replace('Bramble, the grey mare,', 'Bramble, the grey stallion,'));
    assert.equal(Canon.replaceInHtml(next, first.para, first.at, first.span, first.to), null); // that paragraph reads differently now
    // a span across a tag needs the writer
    const p = Canon.sourceParas('<p>the <i>grey</i> mare</p>')[0];
    assert.equal(Canon.replaceInHtml('<p>the <i>grey</i> mare</p>', p.hash, 4, 'grey mare', 'x'), null);
    assert.equal(Canon.replaceInHtml('<p>the <i>grey</i> mare</p>', p.hash, 9, 'mare', 'stallion'), '<p>the <i>grey</i> stallion</p>');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

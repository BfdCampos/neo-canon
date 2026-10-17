'use strict';

// First said, first kept, and the story so far (docs/semantics/STORY.md):
// the owner's own text with a fake reader, the gates on a key point, the
// entry file's section, and a later sentence that gives the deed to
// someone else.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Canon = require('../canon.js');

const NOTES = 'John has green eyes and likes to read old books.';
const OWNER = '“Hello” John said. But there was no answer. He reached his hand through the swirling red vortex in front of him, as pages and random items flew around his room. Just as he fixed his blue eyes on the chaos, he perceived something—someone… Faintly he heard back. “Hello”.';
const REACHED = 'He reached his hand through the swirling red vortex in front of him, as pages and random items flew around his room';

// a shelf in memory: one book's chapters, then its Notes
function shelf(chapters, notes = NOTES) {
  let meta = {};
  let cache = null;
  const files = {};
  const sources = () => [
    ...chapters.map((html, i) => ({ bookId: 'door', chId: 'c' + (i + 1), book: 'The Door', label: 'Ch ' + (i + 1), html: [].concat(html).map((p) => `<p>${p}</p>`).join('') })),
    { bookId: 'door', chId: 'notes', book: 'The Door', label: 'Notes', notes: true, html: `<p>${notes}</p>` }
  ];
  const io = {
    sources, meta: () => structuredClone(meta), saveMeta: (m) => { meta = structuredClone(m); },
    entries: () => Object.entries(files).map(([id, text]) => ({ id, text })), saveEntry: (id, t) => { files[id] = t; },
    notSlips: () => io.dismissed || [], cache: () => cache && structuredClone(cache), saveCache: (c) => { cache = structuredClone(c); },
    knownWords: async (ws) => Object.fromEntries(ws.map((w) => [w, true]))
  };
  return { io, files, chapters, entry: (id) => files[id] && Canon.parseEntry(files[id]), meta: () => meta, cache: () => cache };
}

const ANSWERS = {
  propose: [
    { para: 'John has green eyes', facts: [{ entity: 'John', kind: 'person', attr: 'eyes', value: 'green', quote: 'John has green eyes' }] },
    { para: '“Hello” John said', facts: [{ entity: 'John', kind: 'person', attr: 'eyes', value: 'blue', quote: 'his blue eyes' }] }
  ],
  events: [
    { para: '“Hello” John said', events: [
      { who: ['John'], did: 'John reached through a red vortex', where: 'in his room', quote: REACHED },
      { who: ['John'], did: 'John said hello', where: '', quote: '“Hello” John said' }] }
  ],
  refers: [{ sentence: 'Just as he fixed', span: 'his', entity: 'John', answer: 'yes' }]
};

test('the owner\'s text: the first thing said of John is kept without asking; "his blue eyes" is a slip, never a question', async () => {
  const S = shelf([OWNER]);
  const reader = Canon.fakeReader(ANSWERS);
  const r = await Canon.createEngine({ io: S.io, reader }).readShelf();
  assert.equal(r.needs, 0);
  const john = S.entry('john');
  // (and he is male: the narration's he and his, sentence after sentence, none against)
  assert.deepEqual(john.facts.map((f) => `${f.attr} ${f.value} ${f.state} ${f.sources.map((s) => s.label).join()}`), ['eyes green verified The Door, Notes', 'sex male verified The Door, Ch 1,The Door, Ch 1']);
  // the reader's "blue", from a pronoun, got through no gate: no fact, no question
  assert.doesNotMatch(S.files.john, /Eyes: blue/);
  assert.equal(S.cache().dropped[Object.keys(S.cache().dropped)[0]].why, 'gate');
  const { slips, asks } = await Canon.createEngine({ io: S.io, reader }).check({ bookId: 'door' });
  assert.deepEqual(slips.map((s) => [s.span, s.to]), [['blue', 'green']]);
  assert.deepEqual(asks, []);
});

test('the owner\'s text: the story so far keeps "John reached through a red vortex in his room", as Canon\'s note with its passage', async () => {
  const S = shelf([OWNER]);
  await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(ANSWERS) }).readShelf();
  const john = S.entry('john');
  // (the "said hello" line is speech: left out)
  assert.deepEqual(john.story.map((x) => [x.did, x.state, x.sources[0].quote]), [['John reached through a red vortex in his room', 'note', REACHED]]);
  assert.match(S.files.john, /## Story so far\n- John reached through a red vortex in his room · Canon’s note\n {2}- The Door, Ch 1: "He reached his hand[^"]*" \{book:door, ch:c1, note:\w+\}\n/);
  assert.equal(S.meta().story['door/c1'] !== undefined, true);
  assert.equal(S.meta().story['door/notes'], undefined); // notes hold no events
  // read again: nothing asked, nothing written
  const before = { ...S.files };
  const again = await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(ANSWERS) }).readShelf();
  assert.equal(again.calls, 0);
  assert.deepEqual(S.files, before);
});

test('a key point through the gates: verbatim, the who named or meant by a pronoun, no word the writer didn\'t write', () => {
  const john = Canon.newEntry('John', 'person');
  const mara = Object.assign(Canon.newEntry('Mara', 'person'), { facts: [Canon.handFact('Sex: female')] });
  const para = (text) => ({ text });
  const gate = (ev, text = OWNER, entries = [john]) => Canon.gateEvent(entries, ev, para(text), '', text, new Map());
  const ok = (ev, text, entries) => { const g = gate(ev, text, entries); return g.why || g.did; };
  assert.equal(ok({ who: ['John'], did: 'John reached through a red vortex', where: 'in his room', quote: REACHED }), 'John reached through a red vortex in his room');
  assert.equal(ok({ who: ['John'], did: 'John reached through a red vortex', quote: 'he reached his hand through the swirling vortex' }), 'quote'); // not verbatim
  assert.equal(ok({ who: ['John'], did: 'John touched a glowing portal', quote: REACHED }), 'invented');
  assert.equal(ok({ who: ['John'], did: 'John and Peter reached through a vortex', quote: REACHED }), 'invented'); // a name nobody wrote
  assert.equal(ok({ who: ['John'], did: 'John said hello', quote: '“Hello” John said' }), 'said');
  assert.equal(ok({ who: ['John'], did: 'John reached through the swirling red vortex in front of him as pages flew around his room', quote: REACHED }), 'long');
  // "he" after John, and Mara between: whose hand is it? Not John's by rule
  const two = 'John came in. Mara stood. He reached through the vortex at once.';
  assert.equal(ok({ who: ['John'], did: 'John reached through the vortex', quote: 'He reached through the vortex at once' }, two, [john, mara]), 'who');
  assert.equal(ok({ who: ['Mara'], did: 'Mara reached through the vortex', quote: 'He reached through the vortex at once' }, two, [john, mara]), 'who');
  // a memory is no deed of the story's now
  assert.equal(ok({ who: ['John'], did: 'John reached into the vortex', quote: 'Dave remembered John reaching into the vortex' }, 'Dave remembered John reaching into the vortex.', [john, Canon.newEntry('Dave', 'person')]), 'memory');
  // a plan or a question is no event
  assert.equal(ok({ who: ['John'], did: 'John reached through the vortex', quote: 'Maybe John reached through the vortex' }, 'Maybe John reached through the vortex.'), 'plan');
  // a new name the paragraph writes becomes an entry; a pronoun or a lower-case word never does
  const dave = gate({ who: ['Dave'], did: 'Dave touched the vortex', quote: 'It was Dave who touched the vortex' }, 'It was Dave who touched the vortex.');
  assert.deepEqual(dave.fresh.map((e) => e.name), ['Dave']);
  assert.equal(ok({ who: ['He'], did: 'He touched the vortex', quote: 'He touched the vortex' }, 'He touched the vortex.'), 'who');
});

test('the section round-trips; a Canon\'s note the writer edits is theirs, and a chapter read again keeps it', async () => {
  const S = shelf([OWNER]);
  await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(ANSWERS) }).readShelf();
  const text = S.files.john;
  assert.equal(Canon.serialiseEntry(Canon.parseEntry(text)), text);
  // edited in a text editor: the words no longer match Canon's mark
  S.files.john = text.replace('a red vortex', 'the red vortex');
  assert.equal(S.entry('john').story[0].state, 'yours');
  // a line typed by hand with no marker is the writer's too
  S.files.john = S.files.john.replace('\n\n## In my words', '\n- John found the key\n\n## In my words');
  assert.deepEqual(S.entry('john').story.map((x) => x.state), ['yours', 'yours']);
  // the chapter edited elsewhere and read again: the writer's lines stay (one marked changed), no second note on the same passage
  S.chapters[0] = OWNER.replace('random items', 'loose things');
  await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(ANSWERS) }).readShelf();
  const after = S.entry('john');
  assert.deepEqual(after.story.map((x) => [x.did, x.state, !!(x.sources[0] || {}).changed]), [['John reached through the red vortex in his room', 'yours', true], ['John found the key', 'yours', false]]);
});

test('a Canon\'s note follows its passage: gone when the passage goes, made afresh when it changes', async () => {
  const S = shelf([OWNER]);
  const answers = structuredClone(ANSWERS);
  await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(answers) }).readShelf();
  S.chapters[0] = OWNER.replace('swirling red vortex', 'swirling green vortex');
  answers.events[0].events[0] = { who: ['John'], did: 'John reached through a green vortex', where: 'in his room', quote: REACHED.replace('red', 'green') };
  await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(answers) }).readShelf();
  assert.deepEqual(S.entry('john').story.map((x) => [x.did, x.state]), [['John reached through a green vortex in his room', 'note']]);
  S.chapters[0] = '“Hello” John said. But there was no answer.';
  await Canon.createEngine({ io: S.io, reader: Canon.fakeReader(answers) }).readShelf();
  assert.deepEqual(S.entry('john').story, []);
});

// Chapter 2 gives the deed to Dave; its decoys don't
const SWAP = 'It was Dave who reached through the red vortex that night, and nobody else.';
const DECOYS = [
  'Dave kicked the vortex shut behind them.',
  'Dave remembered John reaching into the vortex.',
  '“I touched the vortex first,” Dave said.',
  'Dave said he had touched the vortex.'
];
const STORY = {
  ...ANSWERS,
  events: [...ANSWERS.events, { para: 'It was Dave', events: [{ who: ['Dave'], did: 'Dave reached through the red vortex', where: '', quote: 'It was Dave who reached through the red vortex that night' }] },
    { para: 'Dave kicked', events: [{ who: ['Dave'], did: 'Dave kicked the vortex shut', where: '', quote: 'Dave kicked the vortex shut behind them' }] }],
  contradicts: [{ sentence: 'It was Dave', who: 'John', answer: 'yes' }, { sentence: 'Dave kicked', answer: 'no' }, { sentence: 'Dave remembered', answer: 'no' }]
};

test('a later sentence that gives John\'s deed to Dave is a slip on "Dave", citing the earlier passage, with Dave → John as the fix', async () => {
  const S = shelf([OWNER, [SWAP, ...DECOYS]]);
  const reader = Canon.fakeReader(STORY);
  await Canon.createEngine({ io: S.io, reader }).readShelf();
  assert.deepEqual(S.entry('dave').story.map((x) => x.did), ['Dave reached through the red vortex', 'Dave kicked the vortex shut']);
  const asked = [];
  const r2 = { ...reader, contradicts: async (q) => { asked.push(q.sentence); return reader.contradicts(q); } };
  const { slips, asks } = await Canon.createEngine({ io: S.io, reader: r2 }).check({ bookId: 'door' });
  const deeds = slips.filter((s) => s.attr === 'event');
  assert.deepEqual(deeds.map((s) => [s.chId, s.span, s.to, s.name, s.value, s.sources[0].label, s.sources[0].quote]),
    [['c2', 'Dave', 'John', 'John', 'John reached through a red vortex in his room', 'The Door, Ch 1', REACHED]]);
  assert.deepEqual(asks, []);
  // only what shares two distinctive words with the deed (or one found nowhere
  // else) is asked: not the kick (only "vortex", which the shelf says often),
  // never speech or reported speech
  assert.deepEqual(asked, [SWAP]);
  // the slip's word is Dave's, in the writer's own text
  const p = Canon.sourceParas(S.io.sources()[1].html).find((x) => x.hash === deeds[0].para);
  assert.equal(p.text.slice(deeds[0].at, deeds[0].at + 4), 'Dave');
  // Not a slip is remembered against the sentence
  S.io.dismissed = [{ fact: deeds[0].fact, sentence: deeds[0].sentenceHash }];
  assert.deepEqual((await Canon.createEngine({ io: S.io, reader }).check({ bookId: 'door' })).slips.filter((s) => s.attr === 'event'), []);
});

test('only an earlier key point counts; unclear or the quick reader is worth a look; no reader, nothing', async () => {
  const S = shelf([OWNER, [SWAP, ...DECOYS]]);
  const reader = Canon.fakeReader(STORY);
  await Canon.createEngine({ io: S.io, reader }).readShelf();
  const deeds = async (r) => {
    const { slips, asks } = await Canon.createEngine({ io: S.io, reader: r }).check({ bookId: 'door' });
    return [slips.filter((s) => s.attr === 'event').map((s) => s.span), asks.filter((s) => s.attr === 'event').map((s) => s.span)];
  };
  assert.deepEqual(await deeds({ ...reader, contradicts: async () => 'unclear' }), [[], ['Dave']]); // the swap; "remembered John" names him
  // the quick reader isn't asked: the swap is worth a look, "Dave remembered John" isn't
  const quick = Canon.localReader({ id: 'q', tier: 'quick', ask: async () => { throw new Error('asked'); } });
  assert.deepEqual(await deeds({ ...reader, contradicts: quick.contradicts }), [[], ['Dave']]);
  assert.deepEqual(await deeds(null), [[], []]);
  // John's own chapter is never checked against itself
  const own = await Canon.createEngine({ io: S.io, reader: { ...reader, contradicts: async () => 'yes' } }).check({ bookId: 'door', chId: 'c1' });
  assert.deepEqual(own.slips.filter((s) => s.attr === 'event'), []);
});

test('the local reader asks for events, and asks each passage on its own who did the deed', async () => {
  const asked = [];
  // (a reader shown both passages takes A's word for it: each is asked alone)
  const who = (u) => /Sentence: "It was Dave/.test(u) ? 'Dave' : 'John';
  // (and, a deed of no one kind, the two told as the same event)
  const reader = Canon.localReader({ id: 'c', tier: 'careful', ask: async (m) => { asked.push(m); return m.schema === Canon.STORY_SCHEMA ? { v: [{ w: ['John'], d: 'John reached through a red vortex', p: '', q: REACHED }] } : /same event/.test(m.user) ? { a: 'yes' } : { a: who(m.user) }; } });
  assert.deepEqual(await reader.events({ text: OWNER, known: [{ name: 'John', kind: 'person' }] }), [{ who: ['John'], did: 'John reached through a red vortex', where: '', quote: REACHED }]);
  assert.equal(await reader.contradicts({ a: REACHED, label: 'The Door, Ch 1', who: 'John', did: 'John reached through a red vortex', sentence: SWAP, paragraph: SWAP, others: ['Dave'] }), 'yes');
  assert.match(asked[1].user, /^Sentence: "It was Dave[^"]*"\nAccording to this sentence, who reached through a red vortex\?$/);
  assert.deepEqual(asked[1].schema.properties.a.enum, ['John', 'Dave', 'someone or something else', 'the sentence does not say']);
  // and A, on its own, must give it to John
  assert.match(asked[2].user, /^Sentence: "He reached his hand/);
  assert.match(asked[3].user, /Is B about the same event as A\?$/);
  // two people sitting on beds are two events: no
  const two = Canon.localReader({ id: 'c', tier: 'careful', ask: async (m) => (/same event/.test(m.user) ? { a: 'no' } : { a: who(m.user) }) });
  assert.equal(await two.contradicts({ a: REACHED, label: 'x', who: 'John', did: 'John reached through a red vortex', sentence: SWAP, paragraph: SWAP, others: ['Dave'] }), 'no');
  // a deed of one kind done to one thing (a crust given) needs no more
  assert.equal(await two.contradicts({ a: REACHED, label: 'x', who: 'John', did: 'John gave the crust', sentence: SWAP, paragraph: SWAP, others: ['Dave'], kind: 'gave', question: 'who gave the crust' }), 'yes');
  // B gives it to John too, or doesn't say: no
  const same = Canon.localReader({ id: 'c', tier: 'careful', ask: async () => ({ a: 'John' }) });
  assert.equal(await same.contradicts({ a: REACHED, label: 'x', who: 'John', did: 'John reached', sentence: SWAP, paragraph: SWAP, others: ['Dave'] }), 'no');
  const unsaid = Canon.localReader({ id: 'c', tier: 'careful', ask: async () => ({ a: 'the sentence does not say' }) });
  assert.equal(await unsaid.contradicts({ a: REACHED, label: 'x', who: 'John', did: 'John reached', sentence: SWAP, paragraph: SWAP, others: ['Dave'] }), 'no');
});

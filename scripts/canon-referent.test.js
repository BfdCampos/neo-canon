'use strict';

// "his blue eyes" in a sentence that names no one: whose? (canon.js,
// referent). The owner's own paragraph, its decoys, and what the reader's
// yes, no and "cannot tell" do with it; with no reader the writer is asked
// ("Worth a look").

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Canon = require('../canon.js');

const person = (name, facts) => Object.assign(Canon.newEntry(name, 'person'), { facts: facts.map(Canon.handFact) });
const john = (...more) => person('John', ['Eyes: green', ...more]);
const mara = () => person('Mara', ['Eyes: grey', 'Sex: female']);
const OWNER = '“Hello” John said. But there was no answer. He reached his hand through the swirling red vortex in front of him, as pages and random items flew around his room. Just as he fixed his blue eyes on the chaos, he perceived something—someone… Faintly he heard back.';

const check = (text, entries, opts = {}) => Canon.checkSources({ sources: [{ bookId: 'b', chId: 'c', label: 'Chapter 1', html: `<p>${text}</p>` }], entries, ...opts });
const words = (list) => list.map((s) => `${s.span}:${s.strength}`);

test('the owner\'s paragraph, John\'s sex unknown and no reader: one worth a look on "blue", asked of "his"', async () => {
  const r = await check(OWNER, [john()]);
  assert.deepEqual(r.slips, []);
  assert.equal(r.asks.length, 1);
  assert.equal(r.asks[0].span, 'blue');
  assert.equal(r.asks[0].ref, 'his');
  assert.equal(r.asks[0].to, 'green');
  assert.equal(r.asks[0].ask, true);
});

test('with Sex: male, the same paragraph is a slip; with Sex: female, "his" is someone else', async () => {
  assert.deepEqual(words((await check(OWNER, [john('Sex: male')])).slips), ['blue:strong']);
  const she = await check(OWNER, [john('Sex: female')]);
  assert.deepEqual([...she.slips, ...she.asks], []);
});

test('decoys: another name, a new person, two entries, speech', async () => {
  const decoys = [
    'John met Mara. Her blue eyes shone.',
    'John met Pell. His blue eyes shone.',
    'John sat down. The stranger turned. His blue eyes were cold.',
    'John sat down. Then a soldier turned his blue eyes on him.',
    'John stood by his brother. His blue eyes were cold.',
    'John led the mare out. Her blue eyes rolled.',
    '“Hello, John,” said a voice. His blue eyes were cold.',
    '“John!” Pell called. His blue eyes were cold.',
    'John said, “His blue eyes are cold.”',
    'John came in. She looked up. His blue eyes were cold.'
  ];
  for (const text of decoys) {
    for (const entries of [[john()], [john('Sex: male')], [john('Sex: male'), mara()]]) {
      const r = await check(text, entries);
      assert.deepEqual([...r.slips, ...r.asks], [], text);
    }
  }
  // a paragraph naming two people before "his": no one is guessed
  const two = await check('John and Oren sat. His blue eyes were cold.', [john('Sex: male'), person('Oren', ['Sex: male'])]);
  assert.deepEqual([...two.slips, ...two.asks], []);
});

test('a name opening a sentence between is found by the dictionary', async () => {
  const text = 'John left. Pell turned. His blue eyes were cold.';
  const knownWords = async (ws) => Object.fromEntries(ws.map((w) => [w, w !== 'pell']));
  const r = await check(text, [john('Sex: male')], { knownWords });
  assert.deepEqual([...r.slips, ...r.asks], []);
  // "Just" is a word: the owner's paragraph still flags
  assert.deepEqual(words((await check(OWNER, [john('Sex: male')], { knownWords })).slips), ['blue:strong']);
});

test('far from the name (more than three sentences), or past speech, the slip is only worth a look', async () => {
  const far = 'John sat. It rained. The fire hissed. Wind rose. Night came. His blue eyes closed.';
  const r = await check(far, [john('Sex: male')]);
  assert.deepEqual(r.slips, []);
  assert.deepEqual(words(r.asks), ['blue:weak']);
});

test('with a reader: yes is a slip, no is dropped, cannot tell is worth a look; the reader is asked about "his"', async () => {
  const asked = [];
  const reader = (answer) => ({ async refers(q) { asked.push(q); return answer; } });
  const yes = await check(OWNER, [john()], { reader: reader('yes') });
  assert.deepEqual(words(yes.slips), ['blue:weak']);
  assert.equal(asked[0].span, 'his');
  assert.equal(asked[0].entity, 'John');
  const no = await check(OWNER, [john()], { reader: reader('no') });
  assert.deepEqual([...no.slips, ...no.asks], []);
  const unsure = await check(OWNER, [john()], { reader: reader('unclear') });
  assert.deepEqual(words(unsure.asks), ['blue:weak']);
  // the quick reader isn't asked who "his" is: the writer is
  const quick = Canon.localReader({ id: 'q', tier: 'quick', ask: async () => { throw new Error('asked'); } });
  assert.deepEqual(words((await check(OWNER, [john()], { reader: quick })).asks), ['blue:weak']);
  // the fake reader of the tests: an answer from its file
  const fake = Canon.fakeReader({ refers: [{ sentence: 'Just as he fixed', span: 'his', entity: 'John', answer: 'yes' }] });
  assert.deepEqual(words((await check(OWNER, [john()], { reader: fake })).slips), ['blue:weak']);
});

test('a lone pronoun of the other sex is asked of the reader, never of the writer', async () => {
  const text = 'John came in. Then she looked up from the fire.';
  assert.deepEqual((await check(text, [john('Sex: male')])).asks, []);
  const r = await check(text, [john('Sex: male')], { reader: { refers: async () => 'unclear' } });
  assert.deepEqual(words(r.asks), ['she:weak']);
});

test('a writer\'s answer is remembered against the sentence', async () => {
  const first = (await check(OWNER, [john()])).asks[0];
  const notSlips = [{ fact: first.fact, sentence: first.sentenceHash, coref: 'no' }];
  const r = await check(OWNER, [john()], { notSlips });
  assert.deepEqual([...r.slips, ...r.asks], []);
  // a changed sentence is asked again
  const changed = await check(OWNER.replace('the chaos', 'the storm'), [john()], { notSlips });
  assert.equal(changed.asks.length, 1);
});

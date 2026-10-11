'use strict';

// The Tutorial shelf (tutorial/, copied by main.js's tutorial:open): made
// once, found again with the writer's changes, made afresh beside the old
// one, and its story's slips exactly the three it was written with, found by
// the Continuity Pass from the Canon it ships with, with no reader.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');
const Canon = require('../canon.js');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));

function loadMain(dir) {
  const handlers = new Map();
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => dir, getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root, process: { platform: 'linux', on() {}, env: {} }, console, libraryRoot: dir
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
  vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
  const call = (name, ...args) => {
    const out = handlers.get(name)(null, ...args);
    return out === undefined ? out : JSON.parse(JSON.stringify(out));
  };
  call.context = context;
  return call;
}

// what the window does with the answer: the shelf goes in library.json
function shelve(dir, r, name = 'Tutorial') {
  const file = path.join(dir, 'library.json');
  const lib = JSON.parse(fs.readFileSync(file, 'utf8'));
  const shelf = { id: r.shelfId, name, bookIds: r.bookIds, canonId: r.canonId, tutorial: r.bookIds };
  if (r.old) lib.shelves.splice(lib.shelves.findIndex((s) => s.id === r.old), 1, shelf);
  else lib.shelves.push(shelf);
  fs.writeFileSync(file, JSON.stringify(lib));
  return shelf;
}

let hunspell = null;
async function knownWords(words) {
  if (!hunspell) {
    const { loadModule } = require('@farscrl/hunspell-wasm');
    const factory = await loadModule();
    const dir = path.join(root, 'node_modules', 'dictionary-en-gb');
    hunspell = factory.create(factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.aff')), 'gb.aff'), factory.mountBuffer(fs.readFileSync(path.join(dir, 'index.dic')), 'gb.dic'));
  }
  return Object.fromEntries(words.map((w) => [w, hunspell.spell(w)]));
}

const folders = (dir) => fs.readdirSync(dir).filter((d) => /^(book|canon)-/.test(d)).sort();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);

describe('the Tutorial', { concurrency: 1 }, () => {
  test('is made once: two books and a Canon, every placeholder filled, the keys this computer\'s', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tutorial-'));
    try {
      const call = loadMain(dir);
      const r = call('tutorial:open', false);
      assert.equal(r.made, true);
      assert.equal(r.old, null);
      const [lessons, story] = r.bookIds;
      assert.match(lessons, /^book-start-here-/);
      assert.match(story, /^book-across-the-saltings-/);
      assert.equal(r.canonId, 'canon-tutorial-' + r.shelfId);
      assert.deepEqual(folders(dir), [story, lessons, r.canonId].sort());
      for (const file of [...walk(path.join(dir, lessons)), ...walk(path.join(dir, story)), ...walk(path.join(dir, r.canonId))]) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /@(?:LESSONS|STORY|SHELF)@/, file);
      }
      const meta = JSON.parse(fs.readFileSync(path.join(dir, lessons, 'book.json'), 'utf8'));
      assert.equal(meta.id, lessons);
      assert.equal(meta.format, 'notebook');
      assert.equal(meta.chapterOrder.length, 11);
      // the lessons are left out of Canon: they never count as the world
      const canonMeta = JSON.parse(fs.readFileSync(path.join(dir, r.canonId, 'canon.json'), 'utf8'));
      assert.equal(canonMeta.shelfId, r.shelfId);
      assert.deepEqual(canonMeta.out, { [lessons]: meta.chapterOrder });
      assert.ok(fs.statSync(path.join(dir, r.canonId, 'set-aside')).isDirectory());
      // keys as written on this computer (the test's is Linux)
      const l05 = fs.readFileSync(path.join(dir, lessons, 'chapters', 'l05.html'), 'utf8');
      assert.match(l05, /Ctrl\+' runs a Continuity Pass/);
      assert.doesNotMatch(meta.chapterOrder.map((c) => fs.readFileSync(path.join(dir, lessons, 'chapters', c + '.html'), 'utf8')).join(''), /[⌘⌥⇧]/);
      assert.equal(vm.runInContext('keysHere("⌘⇧M, ⌥Enter, ⌘\'", "win32")', call.context), 'Ctrl+Shift+M, Alt+Enter, Ctrl+\'');
      assert.equal(vm.runInContext('keysHere("⌘⇧M", "darwin")', call.context), '⌘⇧M');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('opened again, it is the same shelf with the writer\'s changes: nothing is copied twice', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tutorial-'));
    try {
      const call = loadMain(dir);
      const r = call('tutorial:open', false);
      shelve(dir, r);
      const c1 = path.join(dir, r.bookIds[1], 'chapters', 'c1.html');
      fs.writeFileSync(c1, '<p>My own first line.</p>');
      const before = folders(dir);
      const again = call('tutorial:open', false);
      assert.deepEqual(again, { shelfId: r.shelfId, made: false });
      assert.deepEqual(folders(dir), before);
      assert.equal(fs.readFileSync(c1, 'utf8'), '<p>My own first line.</p>');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('afresh: a new copy, and the old one left whole for the window to set aside', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tutorial-'));
    try {
      const call = loadMain(dir);
      const r = call('tutorial:open', false);
      shelve(dir, r);
      const c1 = path.join(dir, r.bookIds[1], 'chapters', 'c1.html');
      fs.writeFileSync(c1, '<p>My own first line.</p>');
      const fresh = call('tutorial:open', true);
      assert.equal(fresh.made, true);
      assert.equal(fresh.old, r.shelfId);
      assert.notEqual(fresh.shelfId, r.shelfId);
      assert.equal(folders(dir).length, 6);
      assert.equal(fs.readFileSync(c1, 'utf8'), '<p>My own first line.</p>'); // never discarded
      shelve(dir, fresh);
      const lib = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
      assert.deepEqual(lib.shelves.filter((s) => s.tutorial).map((s) => s.id), [fresh.shelfId]);
      // and from now on, that one is found again
      assert.equal(call('tutorial:open', false).shelfId, fresh.shelfId);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('the story yields exactly its three seeded slips, from the Canon it ships with, with no reader', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tutorial-'));
    try {
      const call = loadMain(dir);
      const r = call('tutorial:open', false);
      shelve(dir, r);
      const story = r.bookIds[1];
      const io = { ...vm.runInContext(`canonIO(${JSON.stringify(r.canonId)})`, call.context), knownWords };
      const engine = Canon.createEngine({ io });
      const pick = (s) => [s.chId, s.span, s.to, s.entry, s.attr];
      const seeded = [
        ['c2', 'his', 'her', 'juniper', 'sex'],
        ['c3', 'Marowby', 'Marrowby', 'marrowby', 'name'],
        ['c3', 'brown', 'grey', 'wren-calloway', 'eyes']
      ];
      const { slips, facts } = await engine.check({ bookId: story });
      assert.deepEqual(slips.map(pick), seeded);
      assert.equal(facts, 7); // the seven checked traits (Hesketh's "mule", only said, raises none)
      // the whole shelf: the lessons are left out, so nothing more
      assert.deepEqual((await engine.check({ bookId: story, scope: 'shelf' })).slips.map(pick), seeded);
      // the decoys stay clean: Ballast's mane, a mule in Hesketh's mouth, the pewter sky, eyes that sting
      for (const s of slips) assert.doesNotMatch(s.sentence, /Ballast|mule|pewter|stung/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('every checked fact is verified by rule: its quote is in its chapter, and the shelf establishes its value', () => {
    const dir = path.join(root, 'tutorial');
    const chapter = (ch) => fs.readFileSync(path.join(dir, 'story', 'chapters', ch + '.html'), 'utf8');
    const sources = ['c1', 'c2', 'c3'].map((chId, i) => ({ bookId: '@STORY@', chId, book: 'Across the Saltings', label: 'Ch ' + (i + 1), html: chapter(chId) }));
    const entries = fs.readdirSync(path.join(dir, 'canon', 'entries')).map((f) => {
      const e = Canon.parseEntry(fs.readFileSync(path.join(dir, 'canon', 'entries', f), 'utf8'));
      assert.ok(!e.error, f);
      assert.equal(e.id + '.md', f);
      return e;
    });
    const evidence = Canon.shelfEvidence(sources, entries);
    let verified = 0;
    const waiting = [];
    for (const e of entries) {
      for (const f of e.facts) {
        for (const s of f.sources) {
          assert.equal(s.book, '@STORY@');
          const text = Canon.sourceParas(chapter(s.ch)).map((p) => p.text).join('\n');
          assert.ok(Canon.gateQuote(s.quote, text), `${e.id}: "${s.quote}" is in ${s.ch}`);
        }
        if (f.state === 'verified') {
          verified++;
          assert.equal(Canon.established(evidence.get(e.id + '/' + f.attr)), f.value, `${e.id}/${f.attr}`);
        } else waiting.push(`${e.id}/${f.attr}: ${f.value} · ${f.state}`);
      }
    }
    assert.equal(verified, 7);
    // the one question for Needs You (lesson 10): what Hesketh says, never a fact of the story's
    assert.deepEqual(waiting, ['juniper/species: mule · unverified']);
    assert.equal(entries.find((e) => e.id === 'juniper').facts.find((f) => f.value === 'mule').sources[0].said, 'Hesketh');
    // and the Story so far lessons 4 and 10 point to: Canon's notes, each quote the story's own
    assert.deepEqual(entries.find((e) => e.id === 'hesketh').story.map((x) => x.state), ['note', 'note']);
    for (const e of entries) for (const x of e.story) for (const s of x.sources) assert.ok(Canon.gateQuote(s.quote, Canon.sourceParas(chapter(s.ch)).map((p) => p.text).join('\n')), s.quote);
  });

  test('the lessons keep pace with the story: a chapter is read before a lesson uses it, and the reader is asked for plainly', () => {
    const dir = path.join(root, 'tutorial', 'start-here');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'book.json'), 'utf8'));
    const lesson = (id) => fs.readFileSync(path.join(dir, 'chapters', id + '.html'), 'utf8');
    const read = new Set();
    const readBy = {};
    for (const id of meta.chapterOrder) {
      for (const m of lesson(id).matchAll(/read Chapter (\d)/g)) read.add('c' + m[1]);
      readBy[id] = new Set(read);
    }
    // the reading is spread out: Chapter 1 with lesson 2, Chapter 2 before lesson 4, Chapter 3 before lesson 5
    assert.deepEqual([...readBy.l02], ['c1']);
    assert.deepEqual([...readBy.l04].sort(), ['c1', 'c2']);
    // every slip the Continuity Pass (lesson 5) finds is in a chapter already read
    for (const ch of ['c2', 'c3']) assert.ok(readBy.l05.has(ch), ch);
    // and the Needs You question of lesson 4's Canon tab (Hesketh's mule) is in Chapter 2
    assert.match(fs.readFileSync(path.join(root, 'tutorial', 'story', 'chapters', 'c2.html'), 'utf8'), /more mule than horse/);
    // Get the Reader comes straight after What Canon Is, with its button; lesson 10 needs the reader for its second part, and says so
    assert.equal(meta.chapterTitles.l03, '3 · Get the Reader');
    for (const id of ['l03', 'l10']) assert.match(lesson(id), /<a href="neo:reader">Download the reader<\/a>/, id);
    assert.deepEqual(meta.chapterOrder.filter((id) => /neo:reader/.test(lesson(id))), ['l03', 'l10']);
    // lesson 6's sentence is one the rules catch with no reader (scripts/canon*.test.js check the rule)
    assert.match(lesson('l06'), /Juniper shook his mane\./);
  });

  test('lesson 6\'s sentence, typed at the end of Chapter 3, is a slip with no reader: "his" for the mare', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tutorial-'));
    try {
      const call = loadMain(dir);
      const r = call('tutorial:open', false);
      shelve(dir, r);
      const story = r.bookIds[1];
      const engine = Canon.createEngine({ io: { ...vm.runInContext(`canonIO(${JSON.stringify(r.canonId)})`, call.context), knownWords } });
      const html = fs.readFileSync(path.join(dir, story, 'chapters', 'c3.html'), 'utf8') + '<p>Juniper shook his mane.</p>';
      const { slips } = await engine.check({ bookId: story, chId: 'c3', mode: 'quiet', html: { c3: html }, done: new Set() });
      assert.deepEqual(slips.filter((x) => x.sentence === 'Juniper shook his mane.').map((x) => [x.span, x.to, x.entry]), [['his', 'her', 'juniper']]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// End-to-end tests for Canon on a copy of the Ashfall Road fixture.
// Run with `npm run test:canon` (xvfb-run -a npx electron --no-sandbox
// scripts/canon.e2e.js where there's no display). With CANON_SHOTS=1,
// screenshots of the tab, a slip's popover, the reader's download, Read the
// Shelf at work, the review of a change and a notebook go to
// docs/semantics/screens/ (without it, nothing tracked is written), and from
// the Tutorial's walk, with no reader: the Canon tab's first open, the
// reader's line and window in each state, Get the Reader, Back to Shelf.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-canon-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
// A part (NEO_E2E_PART) runs in a child NEO of its own, on a fresh computer
// and an empty library (NEO_E2E_TMP): 'tutorial' meets the welcome and the
// Tutorial, then walks its lessons with no reader; 'relaunch' opens NEO
// again on the same folders.
const PART = process.env.NEO_E2E_PART || '';
const tmp = PART ? process.env.NEO_E2E_TMP : fs.mkdtempSync(path.join(os.tmpdir(), `neo-canon-test-${process.pid}-`));
const LIB = path.join(tmp, 'NEO Library');
const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
const libFile = path.join(LIB, 'library.json');
if (!PART) {
  fs.cpSync(path.join(FIXTURE, 'library'), LIB, { recursive: true });
  // the shelf starts without a Canon: the test keeps one, as a writer would
  const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
  delete lib.shelves[0].canonId;
  fs.writeFileSync(libFile, JSON.stringify(lib));
  // (the welcome to NEO Canon was answered on this computer long ago)
  fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'settings.json'), JSON.stringify({ canonWelcome: true }));
}
// 'editor' reads the dev chapter of the rebuilt reading (READING.md) with a
// fake reader that reads the editor's way: Read the Shelf pass by pass, an
// entry's profile and sections, a slip on an open fact. CANON_EDITOR_RUN=<dir>
// (what canon-eval.js --keep left of a real reader's run) shows that Canon
// instead, for the screenshots of the docs.
const DEV = path.join(__dirname, 'fixtures', 'canon-editor', 'dev');
const REAL_RUN = PART === 'editor' && process.env.CANON_EDITOR_RUN ? path.resolve(process.env.CANON_EDITOR_RUN) : null;
if (PART === 'editor') {
  fs.cpSync(path.join(DEV, 'library'), LIB, { recursive: true });
  if (REAL_RUN) {
    const kept = fs.existsSync(path.join(REAL_RUN, 'canon')) ? path.join(REAL_RUN, 'canon') : REAL_RUN;
    fs.cpSync(kept, path.join(LIB, 'canon-the-weighhouse-shelf-wh'), { recursive: true });
  }
  fs.mkdirSync(path.join(tmp, 'app', 'models'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'settings.json'), JSON.stringify({ canonWelcome: true, readerChoice: 'careful' }));
  // (the reader on disk, sparse: its size is what says it's there)
  fs.closeSync(fs.openSync(path.join(tmp, 'app', 'models', 'careful.gguf'), 'w'));
  fs.truncateSync(path.join(tmp, 'app', 'models', 'careful.gguf'), 60e6);
}
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
process.env.NEO_CANON_FAKE = PART === 'editor' ? path.join(DEV, 'reader-answers.json') : path.join(FIXTURE, 'reader-answers.json');
if (PART === 'editor') process.env.NEO_CANON_FAKE_MS = '40'; // (slow enough to see each pass)
process.env.NEO_CANON_QUIET_MS = '1500'; // the 90 s pause, shortened for the test
// the reader's download comes from a server of the test's own: a 60 MB file,
// sent at about 12 MB/s so its progress can be seen, Range requests answered
const http = require('http');
const crypto = require('crypto');
const MODEL = Buffer.alloc(60e6, 7);
const ranges = [];
const server = http.createServer((req, res) => {
  const m = /bytes=(\d+)-/.exec(req.headers.range || '');
  let at = m ? +m[1] : 0;
  ranges.push(at);
  res.writeHead(m ? 206 : 200, { 'Content-Length': MODEL.length - at });
  const send = () => {
    if (res.destroyed) return;
    if (at >= MODEL.length) { res.end(); return; }
    const chunk = PART === 'tutorial' ? 150000 : 600000; // (the Tutorial's walk watches it longer)
    res.write(MODEL.subarray(at, at + chunk));
    at += chunk;
    setTimeout(send, 50);
  };
  send();
});
const serving = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const readersFile = path.join(tmp, 'readers.json');
process.env.NEO_CANON_READERS = readersFile;
const SCREENS = process.env.CANON_SHOTS_DIR || path.join(__dirname, '..', 'docs', 'semantics', 'screens');
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let win;
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (code, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await tick(50)) if (await js(code)) return true;
  throw new Error("timed out waiting for " + code + (process.env.CANON_DEBUG ? " :: " + await js(`JSON.stringify([canonReading, canonReadLine, canonPaused, canonPassOn, canonProgress, canonPassFacts, document.activeElement.className, currentTab, !!document.querySelector(".modal-backdrop:not([hidden]), .pop-menu")])`).catch(() => "") : ""));
};
const shot = async (name) => {
  const want = process.env.CANON_SHOTS; // 1 for all, or a part of the names wanted
  if (!want || (want !== '1' && !want.split(',').some((w) => name.includes(w)))) return;
  fs.mkdirSync(SCREENS, { recursive: true });
  await js(`$('#hint').hidden = true`); // a toast left from a step before
  await tick(80);
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(SCREENS, name), img.toPNG());
};
const SALT = 'book-the-salt-crown-salt2';
const CANON = 'canon-the-ashfall-road-shelf-ash';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a shelf without a Canon: the Canon tab says what Canon is and offers one, naming the shelf', async () => {
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  assert.equal(await js(`[...document.querySelectorAll('.tab')].filter((t) => !t.hidden).length`), 5);
  await js(`switchTab('canon')`);
  await until(`!!document.querySelector('#canon-view .cn-invite')`);
  assert.equal(await js(`document.querySelector('.cn-invite .cn-offer').textContent`), 'Keep a Canon for “The Ashfall Road”');
  assert.equal(await js(`document.querySelector('.cn-invite .cn-tutorial button').textContent`), 'Open the Tutorial');
  assert.equal(fs.existsSync(path.join(LIB, CANON, 'canon.json')), true); // (the fixture's, not taken up yet)
  assert.equal(JSON.parse(fs.readFileSync(libFile, 'utf8')).shelves[0].canonId, undefined);
  await js(`switchTab('manuscript')`);
});

test('Keep a Canon for This Shelf takes up the Canon folder and the books gain the tab', async () => {
  await js(`backToShelf()`);
  await js(`keepCanon(library.shelves[0])`);
  assert.equal(JSON.parse(fs.readFileSync(libFile, 'utf8')).shelves[0].canonId, CANON);
  // from the shelf, the shelf's first book opens on its Canon tab
  await until(`book && book.id === library.shelves[0].bookIds[0] && currentTab === 'canon'`);
  assert.ok(fs.existsSync(path.join(LIB, CANON, 'canon.json')));
  assert.ok(fs.statSync(path.join(LIB, CANON, 'entries')).isDirectory());
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}' && !$('.tab[data-tab="canon"]').hidden`);
});

test('the Canon tab, kept by hand: a new entry and a fact of the writer\'s', async () => {
  await js(`switchTab('canon')`);
  await until(`!!document.querySelector('#canon-view .cn-home')`);
  await js(`(async () => {
    canonEdit('bramble', () => { const e = Canon.newEntry('Bramble', 'creature'); e.facts.push(Canon.handFact('Sex: mare')); return e; });
  })()`);
  await until(`!!canon.entries.get('bramble')`);
  await js(`canonShown = 'bramble'; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-entry .cn-fact')`);
  const file = fs.readFileSync(path.join(LIB, CANON, 'entries', 'bramble.md'), 'utf8');
  assert.match(file, /- Sex: female \(mare\) · yours\n {2}- Written in Canon/);
  assert.equal(await js(`document.querySelector('.cn-fact .cn-fv').textContent`), 'female (mare)');
  assert.equal(await js(`[...document.querySelectorAll('#nav-list .cn-item .n-label')].map((x) => x.textContent).join()`), 'Bramble');
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(400);
  await shot('canon-tab-by-hand.png');
});

test('by hand: a value outside the lexicon, two values at once, a name already taken, a file Canon can\'t read', async () => {
  const entries = path.join(LIB, CANON, 'entries');
  await js(`canonEdit('ash', () => Canon.newEntry('Ash', 'person')).then(() => { canonShown = 'ash'; renderCanon(); })`);
  await until(`!!document.querySelector('#canon-view .cn-entry .cn-add')`);
  const addFact = async (text) => {
    await js(`document.querySelector('#canon-view .cn-add').click()`);
    await js(`(() => { const i = document.querySelector('#canon-view .cn-add-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  };
  await addFact('Eyes: violet');
  await until(`canon.entries.get('ash').data.facts.length === 1`);
  assert.equal(await js(`document.querySelector('#canon-view .cn-fact .cn-fv').textContent`), 'violet');
  await until(`!!document.querySelector('#canon-view .cn-add')`);
  await addFact('Eyes: grey');
  await until(`!!document.querySelector('.modal-backdrop:not(#firstrun) .fr-choice')`);
  assert.match(await js(`document.querySelector('.modal-backdrop:not(#firstrun) .fr-choice').closest('.modal').querySelector('h2').textContent`), /Ash already has Eyes: violet/);
  await js(`[...document.querySelectorAll('.modal-backdrop:not(#firstrun) .fr-choice')].find((b) => /Keep Both/.test(b.textContent)).click()`);
  await until(`document.querySelectorAll('#canon-view .cn-warn').length === 2`);
  assert.match(fs.readFileSync(path.join(entries, 'ash.md'), 'utf8'), /- Eyes: violet · yours\n {2}- Written in Canon\n- Eyes: grey · yours/);
  // a second Ash is not made: the one there is shown
  await js(`canonShown = null; renderCanon(); setTimeout(() => canonNewEntry(document.querySelector('#nav-list .cn-new')))`);
  await until(`!!document.querySelector('.modal-backdrop:not(#firstrun) input')`);
  await js(`document.querySelector('.modal-backdrop:not(#firstrun) input').value = 'ASH'; document.querySelector('.modal-backdrop:not(#firstrun) .m-ok').click()`);
  await until(`canonShown === 'ash'`);
  assert.match(await js(`$('#hint').textContent`), /already an entry called ASH/);
  // a hand-edited file with a broken line: listed by its name, the line named
  fs.writeFileSync(path.join(entries, 'odd.md'), '---\nid: odd\nname: Old Wenna\nkind: person\nwho is she?\n---\n');
  await js(`canonRefreshNow()`);
  await until(`[...document.querySelectorAll('#nav-list .cn-item .n-label')].some((x) => x.textContent === 'Old Wenna')`);
  await js(`canonShown = 'odd'; renderCanon()`);
  await until(`/line 5 of this entry’s file \\(odd\\.md\\)/.test(document.querySelector('#canon-view').textContent)`);
  for (const f of ['ash.md', 'odd.md']) fs.rmSync(path.join(entries, f));
  await js(`canonShown = null; canonRefreshNow()`);
  await until(`!canon.entries.has('ash') && !canon.entries.has('odd')`);
});

// the owner's report: John's eyes are green in Notes; three sentences after
// his name, "his blue eyes". With no reader, Canon asks rather than staying quiet.
test('no reader: "his blue eyes" after John is worth a look; Yes makes it green as one undoable edit', async () => {
  const OWNER = '“Hello” John said. But there was no answer. He reached his hand through the swirling red vortex in front of him, as pages and random items flew around his room. Just as he fixed his blue eyes on the chaos, he perceived something—someone… Faintly he heard back.';
  await js(`canonEdit('john', () => { const e = Canon.newEntry('John', 'person'); e.facts.push(Canon.handFact('Eyes: green')); return e; })`);
  await until(`!!canon.entries.get('john')`);
  await js(`switchTab('manuscript')`);
  const body = `document.querySelector('.chapter[data-id="c1"] .chapter-body')`;
  const was = await js(`${body}.innerHTML`);
  await js(`(() => { const b = ${body}; const p = document.createElement('p'); p.textContent = ${JSON.stringify(OWNER)}; b.appendChild(p); b.dispatchEvent(new Event('input')); p.scrollIntoView({ block: 'center' }); })()`);
  await until(`chapterHTML.c1.includes('vortex')`);
  await js(`toggleContinuity()`);
  await until(`canonProgress === '' && canonSlips.some((s) => s.entry === 'john')`);
  const john = `canonSlips.find((s) => s.entry === 'john')`;
  assert.deepEqual(await js(`[${john}.ask, ${john}.span, ${john}.ref, ${john}.range.toString()]`), [true, 'blue', 'his', 'blue']);
  assert.equal(await js(`[...CSS.highlights.get('neo-slip-ask')].map((r) => r.toString()).join()`), 'blue');
  assert.equal(await js(`[...CSS.highlights.get('neo-slip')].some((r) => r.toString() === 'blue')`), false);
  // listed apart, under its own heading, and the pane never says plainly "no slips"
  assert.equal(await js(`document.querySelector('#canon-side .cs-ask-head').textContent`), 'Worth a look');
  assert.match(await js(`document.querySelector('#canon-side .cs-slip.cs-ask').textContent`), /^John · .* · .*his blue eyes on the/);
  const note = await js(`document.querySelector('#canon-side .cs-note').textContent`);
  assert.ok(!/^No slips found against [^·]*\.$/.test(note), note);
  await js(`${john}.range.startContainer.parentElement.scrollIntoView({ block: 'center' })`);
  await tick(300);
  await js(`(() => { const r = ${john}.range.getBoundingClientRect(); canonPopOpen(${john}, r.left, r.bottom + 6); })()`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-claim').textContent`), 'Is “his” John?');
  assert.equal(await js(`document.querySelector('.canon-pop .cp-where').textContent`), 'Canon has John’s eyes as green.');
  assert.deepEqual(await js(`[...document.querySelectorAll('.canon-pop button')].map((b) => b.textContent)`), ['Yes — make it green', 'Yes, but leave it', 'No, someone else']);
  await shot('canon-worth-a-look.png');
  await js(`document.querySelector('.canon-pop .cp-main').click()`);
  const para = `[...${body}.querySelectorAll('p')].find((p) => p.textContent.includes('vortex')).textContent`;
  assert.match(await js(para), /fixed his green eyes/);
  await until(`!canonSlips.some((s) => s.entry === 'john' && s.range)`);
  await js(`document.execCommand('undo')`);
  assert.match(await js(para), /fixed his blue eyes/);
  await until(`[...CSS.highlights.get('neo-slip-ask')].some((r) => r.toString() === 'blue')`);
  // nothing of it in the chapter, and none of it left behind for the tests after
  assert.ok(!/slip|canon/i.test(await js(`captureBody(${body})`)));
  await js(`toggleContinuity()`);
  assert.equal(await js(`CSS.highlights.has('neo-slip-ask')`), false);
  await js(`(() => { const b = ${body}; b.innerHTML = ${JSON.stringify(was)}; b.dispatchEvent(new Event('input')); })()`);
  await until(`!chapterHTML.c1.includes('vortex')`);
  await js(`flushAllSaves()`);
  for (let i = 0; i < 40 && fs.readFileSync(path.join(LIB, SALT, 'chapters', 'c1.html'), 'utf8').includes('vortex'); i++) await tick(100);
  fs.rmSync(path.join(LIB, CANON, 'entries', 'john.md'));
  await js(`canonShown = null; canonRefreshNow()`);
  await until(`!canon.entries.has('john')`);
  await js(`switchTab('canon')`);
});

let tier;
test('no reader on this computer: the Canon tab offers one button to get it', async () => {
  await js(`canonShown = null; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-setup .cn-download')`);
  assert.equal(await js(`document.querySelector('#canon-view .cn-read')`), null);
  // picked from this computer's memory: 16 GB and up the careful reader
  tier = await js(`canon.reader.recommend`);
  const [best, other] = tier === 'careful' ? ['Careful', 'Quick'] : ['Quick', 'Careful'];
  assert.equal(await js(`document.querySelector('.cn-setup .cn-pick').textContent`), `${best} reader · 0.1 GB — recommended for this computer`);
  // one calm stack: one button that downloads and reads, the hand-kept way below it
  assert.equal(await js(`document.querySelector('.cn-setup .cn-download').textContent`), 'Download and Read the Shelf');
  assert.match(await js(`document.querySelector('.cn-setup').textContent`), /When it’s here, Canon starts reading — you can keep writing\./);
  assert.doesNotMatch(await js(`document.querySelector('#canon-view').textContent`), /Nothing in this Canon yet/);
  assert.equal(await js(`!!document.querySelector('.cn-setup .cn-hand .cn-hand-new')`), true);
  assert.match(await js(`document.querySelector('.cn-setup .cn-more').textContent`), /Licence: Apache-2\.0/);
  await js(`$('#nav-pane').classList.remove('open')`);
  await tick(300);
  await shot('canon-setup.png');
  assert.match(await js(`document.querySelector('.cn-setup .cn-more').textContent`), new RegExp(other + ' reader · 0\\.1 GB'));
  assert.equal(fs.existsSync(path.join(tmp, 'app', 'models')), false); // nothing fetched before Download (P0 #2)
  assert.deepEqual(ranges, []);
});

test('the download: progress in the tab, Pause, Resume from where it stopped, then ready', async () => {
  await js(`document.querySelector('.cn-setup .cn-download').click()`);
  await until(`/Downloading the reader · [\\d.]+ of 0\\.1 GB/.test(document.querySelector('.cn-setup .cn-dl-line')?.textContent) && canon.reader.download.got > 0`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')).readerWanted, tier);
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(300);
  await shot('canon-download.png');
  await js(`[...document.querySelectorAll('.cn-setup button')].find((b) => b.textContent === 'Pause').click()`);
  await until(`/Paused at/.test(document.querySelector('.cn-setup .cn-dl-line')?.textContent)`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')).readerWanted, undefined);
  const part = fs.statSync(path.join(tmp, 'app', 'models', tier + '.gguf.part')).size;
  assert.ok(part > 0 && part < MODEL.length);
  process.env.NEO_CANON_FAKE_MS = '120';
  await js(`[...document.querySelectorAll('.cn-setup button')].find((b) => b.textContent === 'Resume').click()`);
  // once it checks out, Canon starts reading: no second button, no stop
  await until(`canonReading`, 20000);
  assert.equal(await js(`!!document.querySelector('#canon-view .cn-ready')`), false);
  assert.match(await js(`document.querySelector('#canon-view .cn-home').textContent`), /Canon will read 2 books and 1 notebook \([\d,]+ words\)/);
  assert.equal(ranges.length, 2);
  assert.ok(ranges[1] >= part); // picked up from the .part
  assert.equal(fs.statSync(path.join(tmp, 'app', 'models', tier + '.gguf')).size, MODEL.length);
  assert.equal(await js(`canon.reader.installed`), tier);
});

test('Read the Shelf (the fake reader), started by the download: progress, a pause while typing, then entries, facts and Needs You', async () => {
  await until(`/Reading .* \\(\\d of \\d+\\)/.test(document.querySelector('#canon-view .cn-read-line')?.textContent)`);
  await until(`canonReadAt && canonReadAt.calls >= 3`);
  await tick(200);
  await shot('canon-reading.png');
  // a key: the reader steps aside within a call, and says so
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))`);
  await until(`/Paused while you write/.test(document.querySelector('#canon-view .cn-paused')?.textContent)`);
  const calls = await js(`canonReadAt.calls`);
  await tick(2500);
  assert.ok(await js(`canonReadAt.calls`) <= calls + 1); // still paused
  await until(`!canonReading && /found/.test(canonReadLine)`, 40000); // resumes after ten seconds of quiet
  process.env.NEO_CANON_FAKE_MS = '';
  // (how many check out is the reader's business: canon-fixture.test.js)
  assert.match(await js(`canonReadLine`), /^Canon found 7 entries and 16 facts\. \d+ checked out; \d+ needs? you\.$/);
  assert.equal(fs.readdirSync(path.join(LIB, CANON, 'entries')).filter((f) => f.endsWith('.md')).length, 7);
  assert.deepEqual(await js(`[...document.querySelectorAll('#nav-list .cn-kind-head')].map((x) => x.textContent)`), ['People', 'Creatures', 'Places']);
  // the writer's own fact stayed theirs, and gained the passages that agree
  const bramble = fs.readFileSync(path.join(LIB, CANON, 'entries', 'bramble.md'), 'utf8');
  assert.match(bramble, /- Sex: female \(mare\) · yours\n {2}- Written in Canon\n {2}- Ember and Thorn, Ch 2: "Bramble, the grey mare, would not cross the ford\." \{book:book-ember-and-thorn-ember1, ch:c2\}/);
  await js(`canonShown = 'bramble'; renderCanon()`);
  await until(`document.querySelectorAll('#canon-side .cs-need').length === canonNeeds().length && canonNeeds().length > 0`);
  assert.equal(await js(`$('#side-pane').classList.contains('open')`), true);
  // a speaker's word and a plan are asked as that, never "is it right?"
  const needs = await js(`[...document.querySelectorAll('#canon-side .cs-need')].map((n) => n.querySelector('strong').textContent + ' ' + [...n.querySelectorAll('.cs-row button')].map((b) => '[' + b.textContent + ']').join(''))`);
  if (process.env.CANON_DEBUG) console.log(needs);
  // and on the entry they sit below the facts, never among them
  await until(`/What others say · Plans/.test(document.querySelector('#canon-view .cn-sub')?.textContent)`);
  assert.match(await js(`[...document.querySelector('#canon-view .cn-sub').nextElementSibling.querySelectorAll('.cn-fv')].map((x) => x.textContent).join()`), /gelding/);
  assert.ok(needs.includes('The horse-trader says Bramble is a gelding. [It’s true][Only what’s said][Skip]'), needs.join('\n'));
  assert.ok(needs.some((n) => /^A plan: Bramble is in foal\. \[It’s happened\]\[Still a plan\]\[Skip\]$/.test(n)), needs.join('\n'));
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(400);
  await shot('canon-tab.png');
  // a source in a book's Notes opens Notes with the quote lit
  await js(`[...document.querySelectorAll('#canon-side .cs-where-btn')].find((b) => /Notes/.test(b.textContent)).click()`);
  await until(`currentTab === 'notes' && CSS.highlights.has('neo-canon-quote')`);
  assert.equal(await js(`[...CSS.highlights.get('neo-canon-quote')][0].toString()`), 'Bramble is in foal by the end of book 2?');
  await js(`switchTab('canon')`);
});

test('the reader, always findable: Reader ready · CPU at the top of an entry; Help → Canon Reader… with its settings', async () => {
  await js(`canonGo('bramble')`);
  await until(`/^Reader ready · CPU/.test(document.querySelector('#canon-view .cn-reader-line')?.textContent)`);
  assert.equal(await js(`document.querySelector('#canon-view').firstElementChild.classList.contains('cn-reader-line')`), true);
  await tick(300);
  await shot('canon-reader-ready.png');
  // the line's Reader settings, Help → Canon Reader… and ⌘K all open one window
  wc.send('menu', { type: 'reader' });
  await until(`!!document.querySelector('#canon-reader .rs-status') && /Reader ready · CPU/.test(document.querySelector('#canon-reader').textContent)`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-reader .fr-choice.sel strong')].map((b) => b.textContent)`), ['Automatic', (tier === 'careful' ? 'Careful' : 'Quick') + ' reader · 0.1 GB']);
  assert.match(await js(`document.querySelector('#canon-reader').textContent`), /Now: CPU\./);
  assert.match(await js(`document.querySelector('#canon-reader .rs-speed').textContent`), /^Measured here: the reader reads about [\d,]+ words a minute\.$/);
  await js(`document.querySelector('#canon-reader .rs-more').open = true`);
  await tick(150);
  await shot('canon-reader-settings.png');
  // CPU only is kept in settings.json, and Automatic takes it away again
  await js(`[...document.querySelectorAll('#canon-reader .fr-choice')].find((b) => b.textContent.startsWith('CPU only')).click()`);
  await until(`canonRdr.hardware === 'cpu' && document.querySelector('#canon-reader .fr-choice.sel strong').textContent === 'CPU only'`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')).readerHardware, 'cpu');
  await js(`[...document.querySelectorAll('#canon-reader .fr-choice')].find((b) => b.textContent.startsWith('Automatic')).click()`);
  await until(`canonRdr.hardware === 'auto'`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')).readerHardware, undefined);
  key('Escape');
  await until(`!document.querySelector('#canon-reader')`);
  await js(`document.querySelector('#canon-view .cn-rl-settings').click()`);
  await until(`!!document.querySelector('#canon-reader')`);
  await js(`document.querySelector('#canon-reader .rs-close').click()`);
  await until(`!document.querySelector('#canon-reader')`);
  // a reader that couldn't start here: said in one line, Try Again and Reader settings, never a dead end
  await js(`canon.reader.failed = { tier: canon.reader.installed }; canonReaderRedraw()`);
  await until(`/^The reader couldn’t start on this computer\. Try AgainReader settings$/.test(document.querySelector('#canon-view .cn-reader-line').textContent)`);
  await js(`canonShown = null; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-failed')`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-view .cn-failed button')].map((b) => b.textContent)`), ['Try Again', 'Reader settings']);
  await tick(200);
  await shot('canon-reader-failed.png');
  await js(`document.querySelector('#canon-view .cn-failed button').click()`);
  await until(`!canon.reader.failed && !!document.querySelector('#canon-view .cn-read')`);
});

const chapterFiles = () => ['c1', 'c2', 'c3'].map((c) => fs.readFileSync(path.join(LIB, SALT, 'chapters', c + '.html'), 'utf8'));
let before;

test('Continuity Pass: six marks (the five traits and the deed given to Ilsa), listed in the right-hand pane, none of it in the chapter', async () => {
  before = chapterFiles();
  await js(`switchTab('manuscript'); toggleContinuity()`);
  await until(`canonProgress === '' && canonSlips.length >= 6`);
  await until(`CSS.highlights.get('neo-slip') && CSS.highlights.get('neo-slip').size === 6`);
  assert.deepEqual(await js(`canonSlips.map((s) => s.range.toString())`), ['his', 'brown', 'elder', 'Corwyck', 'Ilsa', 'stallion']);
  assert.equal(await js(`document.querySelectorAll('#canon-side .cs-slip').length`), 6);
  assert.equal(await js(`$('#side-pane').classList.contains('open')`), true);
  const saved = await js(`[...document.querySelectorAll('.chapter-body')].map((b) => captureBody(b)).join('')`);
  assert.ok(!/slip|canon/i.test(saved));
  assert.deepEqual(chapterFiles(), before);
});

test('hovering a mark opens its popover', async () => {
  const at = await js(`(() => { const r = canonSlips[0].range.getBoundingClientRect(); r.startContainer; canonSlips[0].range.startContainer.parentElement.scrollIntoView({ block: 'center' }); const q = canonSlips[0].range.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`);
  const zoom = await js(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1`);
  await until2(() => wc.sendInputEvent({ type: 'mouseMove', x: Math.round(at[0] * zoom), y: Math.round(at[1] * zoom) }), `!!document.querySelector('.canon-pop')`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-claim').textContent`), 'Bramble is a mare.');
  // the first button is the exact change; a pronoun says male, not which word
  assert.match(await js(`document.querySelector('.canon-pop').textContent`), /his → her.*Bramble is now male….*Not a slip/);
  // the three buttons sit on one row
  assert.equal(await js(`new Set([...document.querySelectorAll('.canon-pop .cp-row button')].map((b) => b.getBoundingClientRect().top)).size`), 1);
  await shot('canon-slip-popover.png');
  // the pointer leaving for elsewhere closes it, after a moment's grace
  wc.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
  await tick(200);
  assert.equal(await js(`!!document.querySelector('.canon-pop')`), true);
  await until(`!document.querySelector('.canon-pop')`, 2000);
  // and so does a key (nothing stays over the words while writing)
  await js(`canonPopOpen(canonSlips[0], 300, 300); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))`);
  assert.equal(await js(`!!document.querySelector('.canon-pop')`), false);
});

test('his → her makes the change as one undoable edit', async () => {
  await js(`canonPopOpen(canonSlips.find((s) => s.span === 'his'), 300, 300)`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-main').textContent`), 'his → her');
  await js(`document.querySelector('.canon-pop .cp-main').click()`);
  assert.equal(await js(`!!document.querySelector('.canon-pop')`), false);
  assert.match(await js(`$('#hint').textContent`), /^Changed\. (⌘Z|Ctrl\+Z) brings it back\.$/);
  const para = `[...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((p) => p.textContent.includes('tossed')).textContent`;
  assert.match(await js(para), /Bramble tossed her head/);
  assert.equal(await js(`CSS.highlights.get('neo-slip').size`), 5);
  assert.equal(await js(`document.querySelectorAll('#canon-side .cs-slip').length`), 5);
  // ⌘Z brings the words back, and the mark and the list with them
  await js(`document.execCommand('undo')`);
  assert.match(await js(para), /Bramble tossed his head/);
  await until(`CSS.highlights.get('neo-slip').size === 6 && document.querySelectorAll('#canon-side .cs-slip').length === 6`);
  assert.match(await js(`document.querySelector('#canon-side .cs-slip q').textContent`), /^Bramble tossed his head and pulled$/);
});

test('Not a slip is remembered against the sentence', async () => {
  await js(`canonPopOpen(canonSlips.find((s) => s.span === 'brown'), 300, 300)`);
  await js(`[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Not a slip').click()`);
  await until(`canonSlips.length === 5`);
  const notSlips = JSON.parse(fs.readFileSync(path.join(LIB, CANON, 'not-slips.json'), 'utf8'));
  assert.deepEqual(notSlips.map((n) => n.fact), ['ilsa-varr/eyes', 'ilsa-varr/eyes']);
  assert.equal(notSlips[1].text, 'Ilsa’s brown eyes narrowed.');
});

test('toggling the pass off clears every mark', async () => {
  await js(`toggleContinuity()`);
  assert.equal(await js(`CSS.highlights.has('neo-slip')`), false);
  assert.equal(await js(`$('#editor-view').classList.contains('canon-side')`), false);
});

test('quiet checking: after a pause the changed paragraphs are checked, and marked only if still paused', async () => {
  const para = (text) => `[...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((p) => p.textContent.includes('${text}'))`;
  const caretAtEnd = (text) => js(`(() => { const p = ${para(text)}; p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.closest('.chapter-body').focus(); })()`);
  await caretAtEnd('girl of eighteen');
  wc.sendInputEvent({ type: 'char', keyCode: ' ' });
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  await tick(300);
  assert.equal(await js(`canonSlips.length`), 0); // nothing while typing (P0 #8)
  // (the read before the check waits out the reader's ten seconds of quiet)
  await until(`canonSlips.length === 1`, 20000);
  assert.deepEqual(await js(`canonSlips.map((s) => [s.span, !!s.quiet])`), [['his', true]]); // brown was dismissed earlier
  assert.equal(await js(`CSS.highlights.get('neo-slip').size`), 1);
  assert.equal(await js(`canonPassOn || $('#editor-view').classList.contains('canon-side')`), false); // no pane, no badge
  // a key in another paragraph leaves the mark; one in its own clears it
  await caretAtEnd('pulled at the reins');
  await js(`document.querySelector('.chapter[data-id="c1"] .chapter-body').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  assert.equal(await js(`canonSlips.length`), 0);
  // an answer that comes back after a key is dropped, not painted
  await js(`(async () => { const p = canonQuietCheck(); canonLastKey = Date.now() + 60000; await p; })()`);
  assert.equal(await js(`canonSlips.length`), 0);
  const saved = await js(`[...document.querySelectorAll('.chapter-body')].map((b) => captureBody(b)).join('')`);
  assert.ok(!/slip|canon/i.test(saved));
});

const EMBER = 'book-ember-and-thorn-ember1';
const NOTES = 'book-field-notes-notes3';
test('Bramble is now a stallion: the review list, snapshots first, each change applied on its own', async () => {
  const emberC2 = fs.readFileSync(path.join(LIB, EMBER, 'chapters', 'c2.html'), 'utf8');
  const notesP1 = fs.readFileSync(path.join(LIB, NOTES, 'chapters', 'p1.html'), 'utf8');
  await js(`switchTab('manuscript'); toggleContinuity()`);
  await until(`canonProgress === '' && canonSlips.some((s) => s.span === 'his')`);
  await js(`canonPopOpen(canonSlips.find((s) => s.span === 'his'), 300, 300)`);
  const now = `[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Bramble is now male…')`;
  assert.equal(await js(`!!${now}`), true);
  await js(`${now}.click()`);
  // "his" says male: the writer says which word
  assert.match(await js(`document.querySelector('.canon-pop .cp-ask').textContent`), /^Bramble is male\. Canon will find every passage that says otherwise.* Stallion, gelding, colt, or just male\?$/);
  await js(`[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Stallion').click()`);
  await until(`canonReview && !canonReview.loading`);
  assert.equal(await js(`document.querySelector('#canon-side .cs-title').textContent`), 'Review Changes · 5 passages in 3 books');
  assert.deepEqual(await js(`canonReview.items.map((x) => [x.book + ', ' + x.label, x.span, x.to, x.state])`), [
    ['Ember and Thorn, Ch 2', 'mare', 'stallion', 'todo'], ['Ember and Thorn, Ch 2', 'her', 'his', 'todo'], ['The Salt Crown, Ch 1', 'her', 'his', 'todo'],
    ['The Salt Crown, Notes', 'in foal', null, 'words'], ['Field Notes, Horses', 'mare', 'stallion', 'todo']]);
  const bramble = fs.readFileSync(path.join(LIB, CANON, 'entries', 'bramble.md'), 'utf8');
  assert.match(bramble, /- Sex: male \(stallion\) · yours\n[^#]*- Written in Canon/);
  assert.match(bramble, /## Set aside\n[\s\S]*- Sex: female \(mare\) · set aside/);
  assert.deepEqual(fs.readFileSync(path.join(LIB, EMBER, 'chapters', 'c2.html'), 'utf8'), emberC2); // nothing until Apply (P0 #10)
  await js(`$('#nav-pane').classList.remove('open')`);
  await tick(300);
  await shot('canon-review-changes.png');
  // a book that isn't open: snapshot first, then one word in one file
  const items = '[...document.querySelectorAll("#canon-side .cs-review")]';
  const click = (i, label) => js(`[...${items}[${i}].querySelectorAll('button')].find((b) => b.textContent === '${label}').click()`);
  await click(0, 'Apply');
  await until(`canonReview.items[0].state === 'applied'`);
  assert.equal(fs.readFileSync(path.join(LIB, EMBER, 'chapters', 'c2.html'), 'utf8'), emberC2.replace('the grey mare,', 'the grey stallion,'));
  const snaps = fs.readdirSync(path.join(LIB, EMBER, 'snapshots'));
  assert.equal(snaps.length, 1);
  assert.match(snaps[0], /Z-r-/);
  assert.equal(fs.readFileSync(path.join(LIB, EMBER, 'snapshots', snaps[0], 'c2.html'), 'utf8'), emberC2); // Restore gives these bytes back (P0 #11)
  // the open book: an ordinary edit, after a snapshot and a structural undo step
  const para = `[...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((p) => p.textContent.includes('ears back')).textContent`;
  await click(2, 'Apply');
  await until(`canonReview.items[2].state === 'applied'`);
  assert.match(await js(para), /Bramble put his ears back/);
  assert.equal(await js(`undoStack[undoStack.length - 1].label`), 'Change Across the Series');
  assert.match(fs.readdirSync(path.join(LIB, SALT, 'snapshots')).join(), /Z-r-/);
  await js(`document.execCommand('undo')`);
  assert.match(await js(para), /Bramble put her ears back/);
  await until(`canonReview.items[2].state === 'todo'`); // and the list says so again
  // the rest: Apply All Shown, there once the whole list has been seen
  await js(`${items}.at(-1).scrollIntoView()`);
  await until(`[...document.querySelectorAll('#canon-side button')].some((b) => b.textContent === 'Apply All Shown')`);
  // Apply All Shown and Stop Reviewing sit on one line in the narrow pane
  assert.equal(await js(`(() => { const [a, b] = document.querySelectorAll('#canon-side .cs-review-top button'); return a.getBoundingClientRect().top === b.getBoundingClientRect().top && a.getBoundingClientRect().height < 30; })()`), true);
  await js(`[...document.querySelectorAll('#canon-side button')].find((b) => b.textContent === 'Apply All Shown').click()`);
  await until(`!canonReview.items.some((x) => x.state === 'todo')`);
  assert.equal(await js(`document.querySelector('#canon-side .cs-done').textContent`), '4 passages changed, 0 skipped, 1 needs your words. Bramble is a stallion.');
  assert.equal(fs.readFileSync(path.join(LIB, NOTES, 'chapters', 'p1.html'), 'utf8'), notesP1.replace('Bramble — mare,', 'Bramble — stallion,'));
  assert.match(fs.readFileSync(path.join(LIB, EMBER, 'chapters', 'c2.html'), 'utf8'), /Bramble flattened his ears/);
  assert.equal(fs.readdirSync(path.join(LIB, EMBER, 'snapshots')).length, 1); // one snapshot per book, before its first change
  await js(`[...document.querySelectorAll('#canon-side button')].find((b) => b.textContent === 'Done').click()`);
  assert.equal(await js(`$('#editor-view').classList.contains('canon-side')`), false);
});

const menuPick = (label) => js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`);
test('notebooks: New Notebook on the shelf, a cloth tile, Pages and nothing else of a book\'s', async () => {
  await js(`backToShelf()`);
  await until(`!$('#bookshelf-view').hidden && !!document.querySelector('.shelf .new-book')`);
  await js(`(() => { const b = document.querySelector('.shelf .new-book'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); })()`);
  await until(`[...document.querySelectorAll('.pop-menu button')].some((b) => b.textContent === 'New Notebook')`);
  await menuPick('New Notebook');
  await until(`book && book.format === 'notebook' && !$('#editor-view').hidden`);
  // ready to type: the name first, as a new book's title is
  await until(`document.activeElement && document.activeElement.id === 'tp-title'`);
  const nb = await js(`book.id`);
  const meta = JSON.parse(fs.readFileSync(path.join(LIB, nb, 'book.json'), 'utf8'));
  assert.equal(meta.format, 'notebook');
  assert.deepEqual(Object.values(meta.chapterTitles), ['First page']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.tab')].filter((t) => !t.hidden).map((t) => t.textContent)`), ['Pages', 'Canon', 'Darlings']);
  assert.equal(await js(`document.querySelector('.chapter-body').classList.contains('no-cap')`), true);
  await js(`(() => { const b = document.querySelector('.chapter-body'); b.innerHTML = '<p>Saltmere — a fishing town on the grey coast. Ilsa Varr was born here.</p>'; b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js(`$('#nav-pane').classList.add('open'); renderNav()`);
  await tick(400);
  await shot('canon-notebook-page.png');
  // on the shelf: distinct from books and scripts, no progress bar
  await js(`backToShelf()`);
  await until(`document.querySelectorAll('.book.nb-tile').length === 2`);
  assert.equal(await js(`[...document.querySelectorAll('.book.nb-tile')].map((x) => x.textContent).join()`), 'Field Notes,Notebook');
  assert.equal(await js(`[...document.querySelectorAll('.book.nb-tile .b-progress, .book.nb-tile .b-refresh')].length`), 0);
  await tick(300);
  await shot('canon-notebook-shelf.png');
});

test('Leave Out of Canon: a page right-clicked, a hollow ring, canon.json\'s out; brought back, read again', async () => {
  await js(`openBook('${NOTES}')`);
  await until(`book && book.id === '${NOTES}' && canon && canon.id === '${CANON}'`);
  await until(`document.querySelector('.nav-item[data-id="p3"]').classList.contains('cn-out')`); // the fixture's Maybe page
  const canonJson = () => JSON.parse(fs.readFileSync(path.join(LIB, CANON, 'canon.json'), 'utf8'));
  await js(`setTimeout(() => notebookPageMenu('p3', 300, 300))`);
  await until(`[...document.querySelectorAll('.pop-menu button')].some((b) => b.textContent.includes('Leave Out of Canon') && b.classList.contains('on'))`);
  await menuPick('Leave Out of Canon');
  await until(`!document.querySelector('.nav-item[data-id="p3"]').classList.contains('cn-out')`);
  assert.deepEqual(canonJson().out, {});
  await js(`setTimeout(() => notebookPageMenu('p1', 300, 300))`);
  await until(`!!document.querySelector('.pop-menu')`);
  await menuPick('Leave Out of Canon');
  await until(`document.querySelector('.nav-item[data-id="p1"]').classList.contains('cn-out')`);
  assert.deepEqual(canonJson().out, { [NOTES]: ['p1'] });
  assert.equal(canonJson().read[`${NOTES}/p1`] !== undefined, true); // left out, its reading stays until it's brought back
  await js(`setTimeout(() => notebookPageMenu('p1', 300, 300))`);
  await until(`!!document.querySelector('.pop-menu')`);
  await menuPick('Leave Out of Canon');
  await until(`!document.querySelector('.nav-item[data-id="p1"]').classList.contains('cn-out')`);
  assert.equal(canonJson().read[`${NOTES}/p1`], undefined); // brought back: read again at the next pause
});

test('Merge Into…, the Dismissed list, and Read Everything Again', async () => {
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  await js(`canonShown = null; switchTab('canon')`);
  await until(`!!document.querySelector('#canon-view .cn-home')`);
  await js(`canonEdit('the-grey', () => { const e = Canon.newEntry('The Grey', 'creature', 'the-grey'); e.words = 'Seen at the ford.\\n'; return e; })`);
  await until(`[...document.querySelectorAll('#nav-list .cn-item')].some((x) => x.textContent === 'The Grey')`);
  await js(`(() => { const i = [...document.querySelectorAll('#nav-list .cn-item')].find((x) => x.textContent === 'The Grey'); i.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 })); })()`);
  await until(`!!document.querySelector('.pop-menu')`);
  await menuPick('Merge Into…');
  await until(`[...document.querySelectorAll('.pop-menu .pm-title')].some((x) => x.textContent === 'Merge The Grey into…')`);
  await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === 'Bramble').click()`);
  await until(`canonShown === 'bramble' && !canon.entries.has('the-grey')`);
  const bramble = fs.readFileSync(path.join(LIB, CANON, 'entries', 'bramble.md'), 'utf8');
  assert.match(bramble, /^aliases: \[The Grey\]$/m);
  assert.match(bramble, /## In my words\nSeen at the ford\.\n$/);
  assert.ok(fs.existsSync(path.join(LIB, CANON, 'set-aside', 'the-grey.md')));
  assert.ok(!fs.existsSync(path.join(LIB, CANON, 'entries', 'the-grey.md')));
  // Dismissed (n) at the foot of the pane: each Not a slip, restorable
  await js(`canonShown = null; renderCanon()`);
  await until(`/Not Slips \\(2\\)/.test(document.querySelector('#canon-side .cs-dismissed-head')?.textContent)`);
  await js(`document.querySelector('#canon-side .cs-dismissed-head').click()`);
  await until(`document.querySelectorAll('#canon-side q.cs-src').length === 2`);
  assert.match(await js(`document.querySelector('#canon-side').textContent`), /Ilsa Varr · Eyes.*Ilsa’s eyes looked almost brown in the firelight\./);
  await js(`[...document.querySelectorAll('#canon-side .cs-row button')].filter((b) => b.textContent === 'Restore').at(-1).click()`);
  await until(`/Not Slips \\(1\\)/.test(document.querySelector('#canon-side .cs-dismissed-head')?.textContent)`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, CANON, 'not-slips.json'), 'utf8')).length, 1);
  assert.equal(await js(`!!document.querySelector('#canon-view .cn-again')`), true);
});

/* ---------- the writer's IDE (docs/semantics/IDE.md) ---------- */

const ENTRIES = path.join(LIB, CANON, 'entries');
// the chapters' and the entries' files, and when each was last written
const libStamps = () => {
  const out = {};
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/[/\\](chapters|entries)[/\\][^/\\]+\.(html|md)$/.test(p)) out[p] = fs.statSync(p).mtimeMs;
    }
  };
  walk(LIB);
  return out;
};
const theme = async (value) => { wc.send('menu', { type: 'pageTheme', value }); await until(`library.pageTheme === '${value}'`); await tick(300); };
const backs = `[...document.querySelectorAll('#canon-view .cn-backs')].map((b) => b.textContent)`;

test('links: a rule entry, [[links]] set as links, Linked from both ways, a rename that keeps them', async () => {
  if (process.env.CANON_THEME) await theme(process.env.CANON_THEME); // to look at the IDE views in another theme
  fs.copyFileSync(path.join(FIXTURE, 'ide', 'the-salt-laws.md'), path.join(ENTRIES, 'the-salt-laws.md'));
  await js(`canonRefreshNow()`);
  await until(`canon.entries.has('the-salt-laws')`);
  await until(`[...document.querySelectorAll('#nav-list .cn-kind-head')].some((x) => x.textContent === 'Rules and Systems')`);
  // (no sentence says whose Bramble is: the writer keeps it by hand)
  await js(`canonEdit('bramble', (d) => { d.facts.push(Canon.handFact('Owner: Tamsin Hale')); })`);
  await until(`canon.entries.get('bramble').data.facts.some((f) => f.attr === 'owner')`);
  await js(`canonEdit('tamsin-hale', (d) => { d.words = 'Rides [[Bramble]] most days, and keeps [[The Salt Laws|the salt accounts]]. Born somewhere near [[Ashby]]?\\n'; })`);
  await js(`canonGo('tamsin-hale')`);
  await until(`document.querySelectorAll('#canon-view .cn-words .cn-link').length === 3`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-view .cn-words .cn-link')].map((a) => a.textContent + (a.classList.contains('cn-unresolved') ? '?' : ''))`), ['Bramble', 'the salt accounts', 'Ashby?']);
  assert.equal(await js(`document.querySelector('#canon-view .cn-fv.cn-link').textContent`), 'Oren Hale (younger)');
  await until(`${backs}.some((t) => /^Linked from/.test(t))`);
  assert.match((await js(backs))[0], /Linked fromBramble · Owner/);
  await until(`${backs}.some((t) => /^Mentioned in · \\d+ passages in 2 books/.test(t))`);
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(400);
  await shot('canon-entry-backlinks.png');
  // the unresolved link offers to make the entry
  await js(`[...document.querySelectorAll('#canon-view .cn-words .cn-link')].at(-1).click()`);
  await until(`[...document.querySelectorAll('.pop-menu button')].some((b) => b.textContent === 'Make an entry for “Ashby”')`);
  await js(`popMenu.close()`);
  // a link opens its entry; Bramble shows Tamsin among those linking to it
  await js(`document.querySelector('#canon-view .cn-words .cn-link').click()`);
  await until(`document.querySelector('#canon-view .cn-name')?.textContent === 'Bramble' && ${backs}.some((t) => /^Linked from/.test(t))`);
  assert.match((await js(backs))[0], /Tamsin Hale · in my words/);
  // a rename: the old name becomes an alias and Bramble's Owner still finds her
  await js(`canonGo('tamsin-hale')`);
  await until(`document.querySelector('#canon-view .cn-name')?.textContent === 'Tamsin Hale'`);
  await js(`(() => { const n = document.querySelector('#canon-view .cn-name'); n.textContent = 'Tamsin Ashe'; n.dispatchEvent(new FocusEvent('blur')); })()`);
  await until(`canon.entries.get('tamsin-hale').data.name === 'Tamsin Ashe'`);
  assert.match(fs.readFileSync(path.join(ENTRIES, 'tamsin-hale.md'), 'utf8'), /^aliases: \[Tamsin Hale\]$/m);
  await until(`${backs}.some((t) => /Linked fromBramble · Owner/.test(t))`);
  await js(`(() => { const n = document.querySelector('#canon-view .cn-name'); n.textContent = 'Tamsin Hale'; n.dispatchEvent(new FocusEvent('blur')); })()`);
  await until(`canon.entries.get('tamsin-hale').data.name === 'Tamsin Hale'`);
});

test('Mentioned in: reading order, folded after eight, a passage opens its chapter with the name lit', async () => {
  // (Merge Into gave Bramble "The Grey", which names any grey: not this test's)
  await js(`canonEdit('bramble', (d) => { d.aliases = d.aliases.filter((a) => a !== 'The Grey'); })`);
  await js(`canonGo('bramble')`);
  await until(`${backs}.some((t) => /^Mentioned in/.test(t))`);
  const rows = `[...document.querySelectorAll('#canon-view .cn-passage')]`;
  assert.equal(await js(`${rows}.filter((r) => !r.hidden).length`), 8);
  assert.match(await js(`document.querySelector('#canon-view .cn-show-all').textContent`), /^Show all \d+$/);
  assert.match(await js(`${rows}[0].textContent`), /^Ember and Thorn, Ch 2 — …to be in autumn.*Bramble, the grey stallion, would not cross the ford/);
  await js(`${rows}[0].querySelector('button').click()`);
  await until(`book && book.id === '${EMBER}' && currentTab === 'manuscript' && CSS.highlights.has('neo-search')`);
  assert.equal(await js(`[...CSS.highlights.get('neo-search')][0].toString()`), 'Bramble');
  assert.equal(await js(`[...CSS.highlights.get('neo-search')][0].startContainer.parentElement.closest('.chapter').dataset.id`), 'c2');
});

const SIDE_X = 1395;
// input sent to a window that's busy settling can be lost: send it again until it lands
const until2 = async (send, code, tries = 4) => {
  for (let i = 0; i < tries; i++) {
    send();
    try { return await until(code, 2000); } catch (err) { if (i === tries - 1) throw err; }
  }
};
test('In this chapter: the right-hand pane lists who and what the chapter names, the caret\'s in the accent', async () => {
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  await js(`switchTab('manuscript')`);
  // the caret in Bramble's paragraph of Ch 1
  await js(`(() => { const p = [...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((x) => x.textContent.includes('did not like the convoy')); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.setStart(p.firstChild, 3); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await until2(() => { wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 400 }); wc.sendInputEvent({ type: 'mouseMove', x: SIDE_X, y: 400 }); },
    `$('#side-pane').classList.contains('open') && !!document.querySelector('#canon-here .ch-name')`);
  const names = await js(`[...document.querySelectorAll('#canon-here .ch-name')].map((b) => b.textContent + (b.classList.contains('here') ? '*' : ''))`);
  assert.equal(await js(`document.querySelector('#canon-here .ch-title').textContent`), 'In this chapter');
  assert.ok(names.includes('Bramble*') && names.includes('Ilsa Varr'), names.join());
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-here .ch-kind')].map((k) => k.textContent)`), ['People', 'Creatures', 'Places']);
  const bramble = `[...document.querySelectorAll('#canon-here .ch-name')].find((b) => b.textContent === 'Bramble')`;
  await js(`${bramble}.dispatchEvent(new MouseEvent('mouseenter'))`);
  // (Owner shows once checked: the reader's checking decides, canon-fixture.test.js)
  assert.match(await js(`document.querySelector('#canon-here .ch-facts').textContent`), /^horse · (Tamsin Hale · )?stallion( · Tamsin Hale)?$/);
  await tick(300);
  await shot('canon-in-this-chapter.png');
  // with the pane open, keeping it current costs next to nothing per key
  const ms = await js(`(() => { const t0 = performance.now(); for (let i = 0; i < 50; i++) { chapterHTML.c1 += ''; canonHereUpdate(); } return (performance.now() - t0) / 50; })()`);
  assert.ok(ms < 4, ms + ' ms');
  // ⌥-click: the entry beside the page; Esc goes back
  await js(`${bramble}.dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true }))`);
  await until(`!!document.querySelector('#canon-here .cn-entry')`);
  assert.equal(await js(`document.querySelector('#canon-here .cn-name').textContent`), 'Bramble');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await until(`!document.querySelector('#canon-here .cn-entry') && !!document.querySelector('#canon-here .ch-name')`);
  // a click opens the entry in the Canon tab
  await js(`${bramble}.click()`);
  await until(`currentTab === 'canon' && canonShown === 'bramble' && !!document.querySelector('#canon-view .cn-entry')`);
});

test('In this chapter: absent on a shelf without a Canon; On this page in Notes', async () => {
  await js(`switchTab('notes')`);
  await until(`$('#aux-editor').dataset.kind === 'notes'`);
  await js(`canonHereUpdate(true)`);
  await until(`document.querySelector('#canon-here .ch-title')?.textContent === 'On this page'`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-here .ch-name')].map((b) => b.textContent)`), ['Bramble']);
  await js(`switchTab('manuscript')`);
  await js(`stopCanon(library.shelves[0])`);
  await js(`canonTabUpdate(); canonHereUpdate(true)`);
  assert.equal(await js(`document.querySelector('#canon-here').children.length`), 0);
  await js(`library.shelves[0].canonId = '${CANON}'; writeLibrary(library)`);
  await js(`canonTabUpdate()`);
});

const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
const CMD = process.platform === 'darwin' ? 'meta' : 'control';
const goRows = `[...document.querySelectorAll('.go-row')].map((r) => r.querySelector('.go-title').textContent + ' | ' + r.querySelector('.go-group').lastChild.textContent)`;
test('Go to Anything: ⌘K, "grey mare", Enter: the Canon tab shows Bramble', async () => {
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  await js(`switchTab('manuscript')`);
  await until2(() => key('K', [CMD]), `!!document.querySelector('.go-box .go-input') && document.activeElement === document.querySelector('.go-input')`);
  assert.equal(await js(`document.querySelector('.go-input').placeholder`), 'Go to a chapter, an entry, a passage or a command');
  wc.insertText('grey mare');
  await until(`${goRows}.some((r) => / \\| Passage$/.test(r)) && go.shelf.length > 0`);
  const rows = await js(goRows);
  assert.equal(rows[0], 'Bramble | Entry');
  assert.ok(rows.some((r) => /^Species: horse \| Fact$/.test(r)), rows.join('\n'));
  await tick(200);
  await shot('canon-go-anything.png');
  key('Return');
  await until(`!go && currentTab === 'canon' && canonShown === 'bramble' && document.querySelector('#canon-view .cn-name')?.textContent === 'Bramble'`);
  assert.equal(JSON.parse(await js(`localStorage.getItem('neo.goRecent')`))[0].key, 'entry:bramble');
});

test('Go to Anything: a menu command runs as if picked; Esc puts the caret back; no Canon, no entries', async () => {
  await js(`switchTab('manuscript')`);
  const caret = `(() => { const s = getSelection(); return s.rangeCount ? [s.anchorNode.textContent.slice(0, 20), s.anchorOffset, document.activeElement.className] : null; })()`;
  await js(`(() => { const p = [...document.querySelectorAll('.chapter[data-id="c2"] .chapter-body p')][1]; p.closest('.chapter-body').focus(); const r = document.createRange(); r.setStart(p.firstChild, 7); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  const was = await js(caret);
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('pap kdp');
  await until(`${goRows}.length > 0`);
  assert.equal((await js(goRows))[0], 'Paperback for KDP… | Command');
  key('Escape');
  await until(`!go`);
  assert.deepEqual(await js(caret), was);
  assert.equal(await js(`$('#editor-view').hidden`), false); // Esc closed the palette, not the book
  // a command: Take Snapshot, through the menu's own item
  const snaps = () => fs.readdirSync(path.join(LIB, SALT, 'snapshots')).length;
  const n = snaps();
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('snapshot');
  await until(`(${goRows}[0] || '') === 'Take Snapshot | Command'`);
  key('Return');
  await until(`/Snapshot taken|Nothing has changed since your last snapshot/.test($('#hint').textContent)`);
  assert.ok(snaps() >= n);
  // a shelf without a Canon: chapters, passages and commands only
  await js(`stopCanon(library.shelves[0])`);
  await js(`canonTabUpdate()`);
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('bramble');
  await until(`${goRows}.some((r) => / \\| Passage$/.test(r))`);
  const groups = new Set((await js(goRows)).map((r) => r.split(' | ')[1].replace(/^.*?(Chapter|Passage|Command)$/, '$1')));
  assert.deepEqual([...groups].filter((g) => !['Chapter', 'Passage', 'Command'].includes(g)), []);
  key('Escape');
  await until(`!go`);
  await js(`library.shelves[0].canonId = '${CANON}'; writeLibrary(library).then(() => canonTabUpdate())`);
});

// distinct colours in a canvas: a map that drew something has many
const colours = (sel) => js(`(() => { const c = document.querySelector('${sel}'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return seen.size; })()`);
const zoomed = async (p) => { const z = await js(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1`); return { x: Math.round(p.x * z), y: Math.round(p.y * z) }; };
let stamps;
test('the small map: the open entry and its neighbours, at the top of the Canon tab\'s pane', async () => {
  stamps = libStamps();
  await js(`canonGo('bramble')`);
  await until(`!!document.querySelector('#canon-side .map-small canvas') && document.querySelector('#canon-side').firstChild.classList.contains('map-small')`);
  await tick(400);
  assert.ok((await colours('#canon-side .map-small canvas')) > 8);
  // the open entry and those one step from it
  const shown = await js(`mapSmall.map.nodes().map((d) => d.id).sort().join()`);
  assert.equal(shown, 'bramble,tamsin-hale');
  await theme('night');
  await js(`$('#nav-pane').classList.add('open'); $('#paper-scroll').scrollTop = 0`);
  await tick(300);
  await shot('canon-map-widget.png');
  await js(`$('#nav-pane').classList.remove('open')`);
});

test('World Map: View → World Map shows every entry; clicking Rook opens Rook', async () => {
  await js(`window.neo.menuRun('View › World Map')`);
  await until(`!!document.querySelector('#map-view') && NeoMap.nodes().length > 0`);
  assert.equal(await js(`NeoMap.nodes().length`), await js(`[...canon.entries.values()].filter((x) => x.data).length`));
  await tick(300);
  const at = await zoomed(await js(`NeoMap.screenPos('rook')`));
  wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
  wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await until(`!document.querySelector('#map-view') && canonShown === 'rook' && document.querySelector('#canon-view .cn-name')?.textContent === 'Rook'`);
});

test('World Map: 2D and 3D, a drag that turns it, Find, the legend; in night and light; nothing written', async () => {
  await until2(() => key('M', [CMD, 'shift']), `!!document.querySelector('#map-view') && NeoMap.nodes().length > 0`);
  await js(`document.querySelector('#map-view .map-modes button[data-mode="2d"]').click()`);
  await tick(900);
  assert.equal(await js(`JSON.parse(localStorage.getItem('neo.mapLook')).mode`), '2d');
  assert.ok((await colours('#map-view .map-canvas')) > 8);
  wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 400 });
  await tick(200);
  await shot('canon-map-2d-night.png');
  await js(`document.querySelector('#map-view .map-modes button[data-mode="3d"]').click()`);
  await tick(900);
  const where = `NeoMap.nodes().map((d) => NeoMap.screenPos(d.id)).map((p) => Math.round(p.x) + ',' + Math.round(p.y)).join(' ')`;
  const before = await js(where);
  // a drag across empty space turns the world
  const from = await zoomed({ x: 120, y: 760 });
  wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { wc.sendInputEvent({ type: 'mouseMove', x: from.x + i * 18, y: from.y - i * 4, button: 'left', modifiers: ['leftButtonDown'] }); await tick(16); }
  wc.sendInputEvent({ type: 'mouseUp', x: from.x + 144, y: from.y - 32, button: 'left', clickCount: 1 });
  await tick(900);
  assert.notEqual(await js(where), before);
  assert.ok((await colours('#map-view .map-canvas')) > 8);
  // who appears together, faintly; hovering a node lights it and its neighbours
  await js(`document.querySelector('#map-view .map-together input').click()`);
  assert.equal(await js(`JSON.parse(localStorage.getItem('neo.mapLook')).together`), true);
  await tick(300);
  const tamsin = await zoomed(await js(`NeoMap.screenPos('tamsin-hale')`));
  wc.sendInputEvent({ type: 'mouseMove', x: tamsin.x, y: tamsin.y });
  await tick(200);
  await shot('canon-map-3d-night.png');
  await js(`document.querySelector('#map-view .map-together input').click()`);
  // ⌘K while the map is up finds on the map
  key('K', [CMD]);
  await until(`document.activeElement === document.querySelector('#map-view .map-find')`);
  assert.equal(await js(`!!go`), false);
  wc.insertText('salt laws');
  await tick(800);
  const p = await js(`NeoMap.screenPos('the-salt-laws')`);
  const box = await js(`(() => { const r = document.querySelector('#map-view').getBoundingClientRect(); return [r.width, r.height]; })()`);
  assert.ok(Math.abs(p.x - box[0] / 2) < 30 && Math.abs(p.y - box[1] / 2) < 30, JSON.stringify([p, box]));
  // Esc in Find with words in it clears them; the map stays
  key('Escape');
  await tick(100);
  assert.deepEqual(await js(`[!!document.querySelector('#map-view'), document.querySelector('#map-view .map-find').value]`), [true, '']);
  // the legend hides a kind (and keeps it hidden on this device)
  const n = await js(`NeoMap.nodes().length`);
  await js(`[...document.querySelectorAll('#map-view .map-kind')].find((b) => b.textContent === 'Creatures').click()`);
  assert.equal(await js(`NeoMap.nodes().length`), n - 2);
  assert.deepEqual(await js(`JSON.parse(localStorage.getItem('neo.mapLook')).hidden`), ['creature']);
  await js(`[...document.querySelectorAll('#map-view .map-kind')].find((b) => b.textContent === 'Creatures').click()`);
  // three hundred entries turn smoothly (each frame drawn in under 16 ms)
  const ms = await js(`(() => {
    const K = Canon.KINDS;
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: 'n' + i, name: 'Entry ' + i, kind: K[i % K.length], mentions: (i * 7) % 60 }));
    const edges = [];
    for (let i = 1; i < 300; i++) edges.push({ a: 'n' + i, b: 'n' + Math.floor(i / 3), why: 'fact', n: 1 });
    NeoMap.active.setGraph({ nodes, edges });
    const t = [];
    const c = document.querySelector('#map-view .map-canvas').getContext('2d');
    // (reading a pixel back makes each frame finish its drawing before it's timed)
    for (let i = 0; i < 60; i++) { const t0 = performance.now(); NeoMap.active.turn(0.03, 0.005); c.getImageData(0, 0, 1, 1); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    return t[Math.floor(t.length * 0.9)];
  })()`);
  // (a regression guard, not a benchmark: a slow, busy test VM draws a
  // frame in 20–30 ms where a writer's computer takes under 16)
  assert.ok(ms < 60, ms + ' ms a frame');
  if (process.env.CANON_DEBUG) console.log('300 entries: ' + ms.toFixed(1) + ' ms a frame (90th percentile)');
  await js(`mapFullDraw()`);
  // the light theme
  await js(`mapClose()`);
  assert.deepEqual(libStamps(), stamps); // browsing wrote nothing
  await theme('light');
  await until2(() => key('M', [CMD, 'shift']), `!!document.querySelector('#map-view') && NeoMap.nodes().length > 0`);
  await tick(500);
  wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 400 });
  await tick(200);
  await shot('canon-map-3d-light.png');
  await js(`document.querySelector('#map-view .map-modes button[data-mode="2d"]').click()`);
  await tick(900);
  await shot('canon-map-2d-light.png');
  assert.ok((await colours('#map-view .map-canvas')) > 8);
  key('Escape');
  await until(`!document.querySelector('#map-view')`);
  assert.equal(await js(`$('#editor-view').hidden`), false); // Esc closed the map, not the book
  await theme('night');
});

test('the UX review: offers name the shelf, ⌘K finds Canon and no junk, the shortcuts sheet, the menu, Enter in New Entry', async () => {
  // a status shelf: named, warned about, and the book offered a shelf of its own
  const offer = await js(`canonOffer({ name: 'Works in Progress', bookIds: ['a', 'b'] }, { id: 'a', title: 'Ember' }).map((o) => o.label + ' — ' + o.desc)`);
  assert.deepEqual(offer, ['Keep a Canon for “Works in Progress” — Canon treats every book on this shelf as one world. If this book is its own story, move it to a shelf of its own first.',
    'Move “Ember” to a New Shelf and Keep a Canon There — The other books stay where they are.']);
  assert.equal((await js(`canonOffer({ name: 'The Ashfall Road', bookIds: ['a', 'b'] }, { id: 'a', title: 'Ember' })`)).length, 1);
  // ⌘K: Canon's own commands; letters scattered across a menu's path are not an answer
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  await js(`switchTab('manuscript')`);
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('canon');
  await until(`${goRows}.length > 0`);
  const rows = await js(goRows);
  assert.equal(rows[0], 'Canon | Command');
  assert.ok(rows.includes('Read the Shelf | Command') && !rows.some((r) => /Română|Spellcheck Language/.test(r)), rows.join('\n'));
  key('Escape');
  await until(`!go`);
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('mare');
  await until(`${goRows}.length > 0`);
  assert.ok(!(await js(goRows)).some((r) => /Smaller Text|Markdown Emphasis|Email Draft/.test(r)));
  key('Escape');
  await until(`!go`);
  // the shortcuts sheet has Canon's keys
  const sheet = await js(`bookShortcutSections().flatMap((s) => s.rows.map((r) => r[1])).join('|')`);
  for (const w of ['Go to anything', 'Toggle continuity pass', 'World Map', 'Open the slip under the caret']) assert.ok(sheet.includes(w), w);
  assert.match(await js(`bookShortcutSections().flatMap((s) => s.rows.map((r) => r[2] || '')).join('|')`), /Outline, Canon, Darlings, then round again/);
  // the pause checkbox shows only while some shelf keeps a Canon
  const pause = () => js(`window.neo.menuItems().then((m) => m.some((x) => x.label === 'Check Continuity When I Pause'))`);
  assert.equal(await pause(), true, 'the pause checkbox with a Canon');
  await js(`stopCanon(library.shelves[0])`);
  await tick(200);
  assert.equal(await pause(), false);
  await js(`library.shelves[0].canonId = '${CANON}'; writeLibrary(library).then(() => { canonQuietMenu(); canonTabUpdate(); })`);
  await tick(200);
  assert.equal(await pause(), true);
  // Enter in New Entry names it; the kind is still asked
  win.focus();
  await js(`switchTab('canon')`);
  await until(`!!document.querySelector('#nav-list .cn-new')`);
  await js(`document.querySelector('#nav-list .cn-new').click()`);
  await until(`document.activeElement && document.activeElement.matches('.modal-backdrop:not(#firstrun) input')`);
  wc.insertText('Biscuit');
  await until(`document.querySelector('.modal-backdrop:not(#firstrun) input').value === 'Biscuit'`);
  await until2(() => key('Return'), `!document.querySelector('.modal-backdrop:not(#firstrun) input')`);
  await tick(400);
  // (the Enter's own keyup used to pick the menu's first kind, Person)
  assert.equal(await js(`canon.entries.has('biscuit')`), false, 'the kind menu waits');
  if (await js(`!!document.querySelector('.pop-menu')`)) key('Escape');
  await until(`!document.querySelector('.pop-menu')`);
  assert.equal(await js(`canon.entries.has('biscuit')`), false);
  // a folder named like an entry (a sync tool's) doesn't take the tab down
  fs.mkdirSync(path.join(LIB, CANON, 'entries', 'conflict.md'));
  await js(`canonLoad(true).then(() => renderCanon())`);
  await until(`canon.entries.has('bramble') && !canon.entries.has('conflict')`);
  fs.rmdirSync(path.join(LIB, CANON, 'entries', 'conflict.md'));
});

test('the QA pass: ⌘\' starts at once with a reader, and the World Map from the page leaves no pane over it', async () => {
  win.focus();
  // the keys typed just above pause the reader for ten seconds; a pass the
  // writer starts doesn't wait for that: type now, then ⌘'
  await js(`switchTab('manuscript'); canonPassOn && canonPassOff()`);
  await js(`(() => { const b = document.querySelector('.chapter[data-id="c1"] .chapter-body'); b.focus(); })()`);
  key('ArrowRight');
  await tick(300);
  const t0 = Date.now();
  key("'", [CMD]);
  await until(`canonPassOn && canonProgress === '' && canonPassFacts > 0`, 9000);
  assert.ok(Date.now() - t0 < 5000, (Date.now() - t0) + ' ms');
  key("'", [CMD]);
  await until(`!canonPassOn`);
  await until2(() => key('M', [CMD, 'shift']), `!!document.querySelector('#map-view')`);
  await tick(600);
  assert.equal(await js(`$('#side-pane').classList.contains('open') || $('#editor-view').classList.contains('canon-side')`), false);
  await js(`mapClose()`);
});

// The owner's report (docs/semantics/STORY.md): Notes say John has green
// eyes; Chapter 1 is the owner's own paragraph; Chapter 2 gives the vortex
// to Dave. With the (fake) reader: nothing in Needs You for John, his key
// point under Story so far and In this chapter, ⌘K finds it, and the
// swap is a slip on "Dave" whose fix is one undoable edit.
const OWNER_TEXT = '“Hello” John said. But there was no answer. He reached his hand through the swirling red vortex in front of him, as pages and random items flew around his room. Just as he fixed his blue eyes on the chaos, he perceived something—someone… Faintly he heard back. “Hello”.';
const SWAP_TEXT = 'It was Dave who touched the red vortex that night, and nobody else.';
let DOOR;
test('the owner\'s text, read: the first thing said of John is kept, nothing for him waits in Needs You, and Story so far has his vortex', async () => {
  await js(`canonPassOn && canonPassOff()`);
  DOOR = await js(`(async () => { const b = await window.neo.createBook({ title: 'The Door' }); library.shelves[0].bookIds.push(b.id); await writeLibrary(library); return b.id; })()`);
  const dir = path.join(LIB, DOOR);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'book.json'), 'utf8'));
  meta.chapterOrder = ['door1', 'door2'];
  fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'chapters', 'door1.html'), `<p>${OWNER_TEXT}</p>`);
  fs.writeFileSync(path.join(dir, 'chapters', 'door2.html'), `<p>${SWAP_TEXT}</p>`);
  fs.writeFileSync(path.join(dir, 'notes.html'), '<p>John has green eyes and likes to read old books.</p>');
  await js(`openBook('${DOOR}')`);
  await until(`book && book.id === '${DOOR}'`);
  await js(`switchTab('canon'); canonShown = null; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-read')`);
  await js(`canonReadShelfNow()`);
  await until(`!canonReading && /found/.test(canonReadLine)`, 30000);
  const john = fs.readFileSync(path.join(LIB, CANON, 'entries', 'john.md'), 'utf8');
  assert.match(john, /- Eyes: green · verified\n {2}- The Door, Notes: "John has green eyes"/);
  assert.doesNotMatch(john, /Eyes: blue/);
  assert.match(john, /## Story so far\n- John reached through a red vortex in his room · Canon’s note\n {2}- The Door, Ch 1: "He reached his hand through the swirling red vortex/);
  assert.deepEqual(await js(`canonNeeds().filter((x) => x.e.name === 'John' || x.e.name === 'Dave').map((x) => x.key)`), []);
  await js(`canonShown = 'john'; renderCanon()`);
  await until(`/John reached through a red vortex in his room/.test(document.querySelector('#canon-view .cn-story')?.textContent)`);
  assert.equal(await js(`document.querySelector('#canon-view .cn-story .cn-h').textContent`), 'Story so far');
  assert.equal(await js(`document.querySelector('#canon-view .cn-event .cn-by').textContent`), 'Canon’s note');
  assert.ok(!(await js(`[...document.querySelectorAll('#canon-side .cs-need strong')].map((x) => x.textContent).join()`)).includes('John'));
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(400);
  await shot('canon-story-so-far.png');
  await js(`$('#nav-pane').classList.remove('open')`);
});

test('Key points in In this chapter, and ⌘K "vortex" finds John\'s', async () => {
  await js(`switchTab('manuscript')`);
  await js(`(() => { const p = document.querySelector('.chapter .chapter-body p'); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.setStart(p.firstChild, 3); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await until2(() => { wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 400 }); wc.sendInputEvent({ type: 'mouseMove', x: SIDE_X, y: 400 }); },
    `$('#side-pane').classList.contains('open') && !!document.querySelector('#canon-here .ch-point')`);
  assert.equal(await js(`document.querySelector('#canon-here .ch-sub').textContent`), 'Key points');
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-here .ch-point')].map((b) => b.textContent)`), ['John reached through a red vortex in his room']);
  await tick(300);
  await shot('canon-key-points.png');
  await until2(() => key('K', [CMD]), `!!document.querySelector('.go-box .go-input') && document.activeElement === document.querySelector('.go-input')`);
  wc.insertText('vortex');
  await until(`${goRows}.some((r) => /^John reached through a red vortex in his room \\| Fact$/.test(r))`);
  // (Dave's own "touched the vortex" answers too: both entries come first)
  assert.deepEqual((await js(goRows)).slice(0, 2).sort(), ['Dave | Entry', 'John | Entry']);
  key('Escape');
  await until(`!go`);
});

test('the actor swap: "It was Dave who touched the vortex" is a slip on Dave, citing Ch 1, and Keep — it was John swaps the name as one undoable edit', async () => {
  await js(`toggleContinuity()`);
  await until(`canonProgress === '' && canonSlips.some((s) => s.attr === 'event')`, 15000);
  const deed = `canonSlips.find((s) => s.attr === 'event')`;
  assert.deepEqual(await js(`[${deed}.span, ${deed}.to, ${deed}.name, !!${deed}.ask, ${deed}.range.toString()]`), ['Dave', 'John', 'John', false, 'Dave']);
  assert.ok(await js(`[...CSS.highlights.get('neo-slip')].some((r) => r.toString() === 'Dave')`));
  // "his blue eyes" is a slip too: green came first, from the Notes
  assert.ok(await js(`canonSlips.some((s) => s.span === 'blue' && !s.ask)`));
  await js(`${deed}.range.startContainer.parentElement.scrollIntoView({ block: 'center' })`);
  await tick(300);
  await js(`(() => { const r = ${deed}.range.getBoundingClientRect(); canonPopOpen(${deed}, r.left, r.bottom + 6); })()`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-claim').textContent`), 'Canon has John doing this.');
  assert.equal(await js(`document.querySelector('.canon-pop .cp-deed').textContent`), 'John reached through a red vortex in his room');
  assert.equal(await js(`document.querySelector('.canon-pop .cp-where').textContent`), 'Canon’s note from The Door, Ch 1');
  assert.equal(await js(`document.querySelector('.canon-pop .cp-why').textContent`), 'Here, “Dave” seems to have done it.');
  assert.deepEqual(await js(`[...document.querySelectorAll('.canon-pop .cp-row button')].map((b) => b.textContent)`), ['Keep — it was JohnDave → John', 'Not a slip']);
  await shot('canon-deed-popover.png');
  await js(`document.querySelector('.canon-pop .cp-main').click()`);
  const para = `[...document.querySelectorAll('.chapter[data-id="door2"] .chapter-body p')][0].textContent`;
  assert.equal(await js(para), SWAP_TEXT.replace('Dave', 'John'));
  await js(`document.execCommand('undo')`);
  assert.equal(await js(para), SWAP_TEXT);
  assert.ok(!/slip|canon/i.test(await js(`captureBody(document.querySelector('.chapter[data-id="door2"] .chapter-body'))`)));
  await js(`toggleContinuity()`);
});

// The owner's report: It's true pressed again and again added "Sex: female ·
// You, in Canon" each time and the card never left; the entry ended with
// twelve of them.
const entryHead = (id, name) => `---\nid: ${id}\nname: ${name}\nkind: person\naliases: []\n---\n# ${name}\n\n## Facts\n`;
const needCards = `[...document.querySelectorAll('#canon-side .cs-need strong')].map((x) => x.textContent)`;
test('Needs You: It\'s true once, even clicked twice; the card leaves, the fact keeps its passage, and a reload brings nothing back; twelve copies heal', async () => {
  await js(`canonPassOn && canonPassOff()`);
  // the owner's entry as the old It's true left it: twelve copies and the line
  const lady = '- Sex: female · unverified\n  - The Door, Ch 1: "But there was no answer" {book:' + DOOR + ', ch:door1, said}\n';
  fs.writeFileSync(path.join(ENTRIES, 'pio.md'), entryHead('pio', 'Pio') + lady + '- Sex: female · yours\n  - Written in Canon\n'.repeat(12) + '\n## In my words\nMine.\n');
  // and a line only the lady says, waiting
  fs.writeFileSync(path.join(ENTRIES, 'wren.md'), entryHead('wren', 'Wren')
    + '- Sex: male (boy) · unverified\n  - The Door, Ch 1: "Faintly he heard back" {book:' + DOOR + ', ch:door1, said:the lady}\n'
    + '- Lives in: Kellsharrow · unverified\n  - The Door, Ch 1: "Faintly he heard back" {book:' + DOOR + ', ch:door1, plan}\n\n## In my words\n');
  if (await js(`currentTab !== 'canon'`)) await js(`switchTab('canon')`);
  await js(`canonLoad(true).then(() => { canonShown = 'wren'; renderCanon(); canonSideUpdate(); })`);
  await until(`${needCards}.some((x) => /Wren is male/.test(x))`);
  // Pio healed as Canon opened: one fact, the writer's, citing its line; nothing waits
  const pio = fs.readFileSync(path.join(ENTRIES, 'pio.md'), 'utf8');
  assert.equal(pio.match(/- Sex: female/g).length, 1, pio);
  assert.match(pio, /- Sex: female · yours\n {2}- Written in Canon\n {2}- The Door, Ch 1: "But there was no answer"/);
  assert.match(pio, /## In my words\nMine\.\n$/);
  assert.ok(!(await js(needCards)).some((x) => /Pio/.test(x)));
  // It's true, clicked twice at once
  await js(`(() => { const card = [...document.querySelectorAll('#canon-side .cs-need')].find((n) => /Wren is male/.test(n.textContent)); const b = [...card.querySelectorAll('button')].find((x) => x.textContent === 'It’s true'); b.click(); b.click(); })()`);
  await until(`!${needCards}.some((x) => /Wren is male/.test(x))`);
  await tick(300);
  const wren = () => fs.readFileSync(path.join(ENTRIES, 'wren.md'), 'utf8');
  assert.equal(wren().match(/- Sex: male/g).length, 1, wren());
  assert.match(wren(), /- Sex: male \(boy\) · yours\n {2}- The Door, Ch 1: "Faintly he heard back" \{book:[^}]*, said:the lady\}\n/);
  assert.doesNotMatch(wren(), /Written in Canon/);
  // not under What others say either: the fact stands among the facts
  assert.ok(!/male/.test(await js(`document.querySelector('#canon-view .cn-sub')?.nextElementSibling?.textContent || ''`)));
  // Skip on the plan: remembered with the Canon
  await js(`(() => { const card = [...document.querySelectorAll('#canon-side .cs-need')].find((n) => /Wren/.test(n.textContent)); [...card.querySelectorAll('button')].find((x) => x.textContent === 'Skip').click(); })()`);
  await until(`!${needCards}.some((x) => /Wren/.test(x))`);
  await tick(300);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(LIB, CANON, 'canon.json'), 'utf8')).skipped, ['wren|home|Kellsharrow']);
  // opened again: the same, nothing back, nothing doubled
  await js(`canonLoad(true).then(() => { renderCanon(); canonSideUpdate(); })`);
  await tick(500);
  assert.ok(!(await js(needCards)).some((x) => /Wren|Pio/.test(x)));
  assert.equal(wren().match(/- Sex: male/g).length, 1);
  for (const id of ['pio', 'wren']) fs.rmSync(path.join(ENTRIES, id + '.md'));
  await js(`canonLoad(true).then(() => { canonShown = null; renderCanon(); })`);
});

/* ---------- the welcome and the Tutorial, on a fresh computer ---------- */

const parts = [];
const part = (which, name, fn) => parts.push({ which, name, fn });
const settings = () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'app', 'settings.json'), 'utf8')); } catch { return {}; } };
const tutorialShelf = `library.shelves.find((s) => s.tutorial)`;

part('tutorial', 'a fresh computer: the first run, then the welcome; Esc puts it away for good', async () => {
  await until(`!$('#firstrun').hidden`);
  await js(`document.querySelector('#firstrun .fr-choice').click()`);
  await until(`!$('#fr-step2').hidden`);
  await js(`$('#fr-done').click()`);
  await until(`!!$('#welcome')`);
  assert.equal(await js(`$('#wl-h').textContent`), 'Welcome to NEO Canon');
  assert.deepEqual(await js(`[...document.querySelectorAll('#welcome button')].map((b) => b.querySelector('strong') ? b.querySelector('strong').textContent : b.textContent)`), ['Open the Tutorial', 'Set Up the Reader', 'Later']);
  // the reader offered is the catalogue's, sized
  await until(`!/^Canon’s reader finds/.test($('#welcome .wl-reader span').textContent)`);
  assert.match(await js(`$('#welcome .wl-reader span').textContent`), /GB — recommended for this computer|short on memory/);
  assert.equal(settings().canonWelcome, undefined); // shown is not answered
  await shot('welcome-sheet.png');
  await theme('light');
  await shot('welcome-sheet-light.png');
  await theme('night');
  key('Escape');
  await until(`!$('#welcome')`);
  for (let i = 0; i < 40 && !settings().canonWelcome; i++) await tick(50);
  assert.equal(settings().canonWelcome, true);
});

part('tutorial', 'Help → Welcome to NEO Canon… shows it again; Open the Tutorial makes the shelf, keeping a Canon, and opens Start Here', async () => {
  wc.send('menu', { type: 'welcome' });
  await until(`!!$('#welcome')`);
  await js(`$('#welcome .wl-tutorial').click()`);
  await until(`!!${tutorialShelf} && book && book.format === 'notebook'`);
  const shelf = await js(tutorialShelf);
  assert.equal(shelf.name, 'Tutorial');
  assert.ok(shelf.canonId);
  assert.deepEqual(shelf.tutorial, shelf.bookIds);
  assert.equal(await js(`book.id`), shelf.bookIds[0]);
  const disk = JSON.parse(fs.readFileSync(libFile, 'utf8')).shelves.find((s) => s.tutorial);
  assert.equal(disk.canonId, shelf.canonId);
  assert.equal(fs.readdirSync(path.join(LIB, shelf.canonId, 'entries')).length, 6);
  assert.equal(await js(`book.title`), 'Start Here');
  assert.equal(await js(`book.chapterOrder.length`), 11);
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(500);
  await shot('tutorial-start-here.png');
  await js(`$('#nav-pane').classList.remove('open')`);
});

part('tutorial', 'the Tutorial on the shelf, and ⌘\' in its story finds exactly the three seeded slips, with no reader', async () => {
  await js(`backToShelf()`);
  await until(`!$('#bookshelf-view').hidden && !!document.querySelector('.shelf')`);
  await tick(600);
  await shot('tutorial-shelf.png');
  const story = (await js(tutorialShelf)).tutorial[1];
  await js(`openBook('${story}')`);
  await until(`book && book.id === '${story}'`);
  assert.equal(await js(`canonIdFor(book.id) === ${tutorialShelf}.canonId`), true);
  await js(`(() => { const b = document.querySelector('.chapter[data-id="c1"] .chapter-body'); b.focus(); })()`);
  key("'", [CMD]);
  await until(`canonPassOn && canonProgress === '' && canonSlips.length === 3`, 9000);
  assert.deepEqual(await js(`canonSlips.map((s) => s.chId + ' ' + s.span + ' → ' + s.to)`), ['c2 his → her', 'c3 Marowby → Marrowby', 'c3 brown → grey']);
  // fewer checks without the reader, said in one line with its button
  assert.equal(await js(`document.querySelector('#canon-side .cs-reader').textContent`), 'Some checks need the reader. Download it (0.1 GB, runs on this computer).');
  await js(`canonSlips[0].range.startContainer.parentElement.scrollIntoView({ block: 'center' })`);
  await tick(400);
  await shot('tutorial-pass.png');
  key("'", [CMD]);
  await until(`!canonPassOn`);
});

// The Tutorial walked through, lesson by lesson, on a computer with no
// reader: every Try this that needs none succeeds, and the lessons that need
// the reader say so with a button that gets it.
const lessons = () => js(`${tutorialShelf}.tutorial[0]`);
const storyId = () => js(`${tutorialShelf}.tutorial[1]`);
const lessonText = async (n) => { const id = await lessons(); return fs.readFileSync(path.join(LIB, id, 'chapters', 'l' + String(n).padStart(2, '0') + '.html'), 'utf8'); };
const openStory = async (tab = 'manuscript') => {
  const id = await storyId();
  if (await js(`!book || book.id !== '${id}'`)) { await js(`openBook('${id}')`); await until(`book && book.id === '${id}'`); }
  if (await js(`currentTab !== '${tab}'`)) await js(`switchTab('${tab}')`);
};
const caretAtEndOf = (chId) => js(`(() => { const ps = document.querySelectorAll('.chapter[data-id="${chId}"] .chapter-body p'); const p = ps[ps.length - 1]; p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.closest('.chapter-body').focus(); })()`);

part('tutorial', 'lesson 1: ← Back to Shelf at the top left, in sight, and the darling already cut', async () => {
  assert.match(await lessonText(1), /Back to Shelf/);
  await openStory();
  const b = await js(`(() => { const b = $('#back-to-shelf'); const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), left: r.left, top: r.top, w: r.width, opacity: +getComputedStyle(b).opacity, inBar: !!b.closest('#bottombar') }; })()`);
  assert.equal(b.text, '← Back to Shelf');
  assert.ok(b.left < 120 && b.top < 20 && b.w > 60 && b.opacity >= 0.5 && !b.inBar, JSON.stringify(b));
  assert.equal(await js(`!!document.querySelector('#bottombar #back-to-shelf')`), false); // one way back, not two
  await tick(300);
  await shot('back-to-shelf.png');
  await theme('light');
  await shot('back-to-shelf-light.png');
  await theme('night');
  await js(`$('#back-to-shelf').click()`);
  await until(`!$('#bookshelf-view').hidden && $('#editor-view').hidden`);
  await openStory('darlings');
  await until(`/bitten a bishop/.test(document.querySelector('#darlings-list').textContent)`);
});

part('tutorial', 'the Canon tab, first open with no reader: both panes pinned, the reader line with Download; unpinned, it stays so', async () => {
  assert.match(await lessonText(2), /read Chapter 1 of/);
  await openStory('canon');
  await until(`!!document.querySelector('#canon-view .cn-setup') && !!document.querySelector('#nav-list .cn-item')`);
  const panes = `['#nav-pane', '#side-pane'].map((p) => $(p).dataset.pinned === '1' && $(p).classList.contains('open'))`;
  assert.deepEqual(await js(panes), [true, true]);
  assert.match(await js(`document.querySelector('#canon-view .cn-home').textContent`), /^Pick an entry from the list on the left/);
  await tick(400);
  await shot('canon-tab-first-open.png');
  await theme('light');
  await shot('canon-tab-first-open-light.png');
  await theme('night');
  // an entry: the reader line at the top, no reader yet, one button
  await js(`canonGo('juniper')`);
  await until(`/^No reader yet — Download \\(0\\.1 GB\\)Reader settings$/.test(document.querySelector('#canon-view .cn-reader-line')?.textContent)`);
  await shot('canon-reader-none.png');
  // the manuscript keeps its hover-hidden panes; the Canon tab its pins
  await js(`switchTab('manuscript')`);
  assert.deepEqual(await js(`['#nav-pane', '#side-pane'].map((p) => $(p).dataset.pinned === '1')`), [false, false]);
  await js(`switchTab('canon')`);
  assert.deepEqual(await js(panes), [true, true]);
  await js(`$('#nav-pin').click()`);
  await js(`switchTab('manuscript'); switchTab('canon')`);
  assert.equal(await js(`$('#nav-pane').dataset.pinned`), '0'); // this device remembers
  await js(`$('#nav-pin').click()`);
  // Help → Canon Reader… opens from here, and ⌘K finds it
  wc.send('menu', { type: 'reader' });
  await until(`!!document.querySelector('#canon-reader') && /No reader on this computer yet\\.Download the Reader \\(0\\.1 GB\\)/.test(document.querySelector('#canon-reader').textContent)`);
  await shot('canon-reader-window-none.png');
  key('Escape');
  await until(`!document.querySelector('#canon-reader')`);
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('canon reader');
  await until(`(${goRows}[0] || '') === 'Canon Reader… | Command'`);
  key('Return');
  await until(`!!document.querySelector('#canon-reader')`);
  key('Escape');
  await until(`!document.querySelector('#canon-reader')`);
});

part('tutorial', 'lesson 3: Get the Reader, its button in the page starts the download and shows it; the Canon tab\'s line follows; Pause', async () => {
  const id = await lessons();
  await js(`openBook('${id}')`);
  await until(`book && book.id === '${id}'`);
  const link = `document.querySelector('.chapter[data-id="l03"] a[href="neo:reader"]')`;
  await until(`!!${link}`);
  assert.equal(await js(`${link}.textContent`), 'Download the reader');
  // a link in the page is saved with it, as the lesson was written
  assert.match(await js(`captureBody(document.querySelector('.chapter[data-id="l03"] .chapter-body'))`), /<a href="neo:reader">Download the reader<\/a>/);
  await js(`${link}.scrollIntoView({ block: 'center' })`);
  await tick(300);
  await shot('tutorial-get-reader.png');
  await js(`${link}.click()`);
  await until(`!!document.querySelector('#canon-reader') && canonRdr.download.state === 'downloading'`);
  await until(`/Downloading the reader… \\d+%/.test(document.querySelector('#canon-reader .rs-status').textContent)`);
  await shot('canon-reader-window.png');
  key('Escape');
  await until(`!document.querySelector('#canon-reader')`);
  await openStory('canon');
  await js(`canonGo('juniper')`);
  await until(`/^Downloading the reader… \\d+% · Pause/.test(document.querySelector('#canon-view .cn-reader-line')?.textContent) && canonRdr.download.got > 0`);
  await shot('canon-reader-downloading.png');
  await js(`[...document.querySelectorAll('#canon-view .cn-reader-line button')].find((b) => b.textContent === 'Pause').click()`);
  await until(`/^The reader’s download is paused at \\d+% · Resume/.test(document.querySelector('#canon-view .cn-reader-line')?.textContent)`);
  assert.equal(await js(`canonRdr.installed`), null);
  // the Tutorial's Canon isn't read when the reader arrives: its lessons say when
  assert.equal(await js(`canonIsTutorial() && !canonAutoRead()`), true);
});

part('tutorial', 'lessons 4 and 5, no reader: Juniper\'s source opens Chapter 1 lit; Hesketh\'s Story so far; ⌘\' finds the three slips, two fixed, one Not a slip', async () => {
  assert.match(await lessonText(4), /Before this lesson,<\/b> read Chapter 2/);
  assert.match(await lessonText(5), /Before this lesson,<\/b> read Chapter 3/);
  await openStory('canon');
  await js(`canonGo('juniper')`);
  await until(`document.querySelector('#canon-view .cn-name')?.textContent === 'Juniper'`);
  await js(`[...document.querySelectorAll('#canon-view .cn-fact')].find((f) => /Sex/.test(f.textContent)).querySelector('.cn-where').click()`);
  await until(`currentTab === 'manuscript' && CSS.highlights.has('neo-canon-quote')`);
  assert.match(await js(`[...CSS.highlights.get('neo-canon-quote')][0].toString()`), /Juniper, the bay mare/);
  await js(`switchTab('canon'); canonGo('hesketh')`);
  await until(`document.querySelectorAll('#canon-view .cn-event').length === 2`);
  await js(`switchTab('manuscript')`);
  await js(`document.querySelector('.chapter[data-id="c1"] .chapter-body').focus()`);
  key("'", [CMD]);
  await until(`canonPassOn && canonProgress === '' && canonSlips.length === 3`, 9000);
  // (the pass's pane says the reader would check more: here, where its download stands)
  assert.match(await js(`document.querySelector('#canon-side .cs-reader').textContent`), /^The reader’s download is paused at \d+% · ResumeReader settings$/);
  await js(`canonApply(canonSlips.find((s) => s.span === 'his'))`);
  await js(`canonApply(canonSlips.find((s) => s.span === 'Marowby'))`);
  await until(`canonShownSlips().length === 1`);
  await js(`canonNotSlip(canonShownSlips()[0])`);
  await until(`canonShownSlips().length === 0`);
  assert.match(await js(`chapterHTML.c2`), /Juniper tossed her head/);
  assert.match(await js(`chapterHTML.c3`), /lamps of Marrowby/);
  key("'", [CMD]);
  await until(`!canonPassOn`);
});

part('tutorial', 'lesson 6, no reader: "Juniper shook his mane." at the end of Chapter 3 is marked after the pause, and by ⌘\' at once', async () => {
  assert.match(await lessonText(6), /Juniper shook his mane\./);
  await openStory();
  await caretAtEndOf('c3');
  key('Return');
  await tick(100);
  wc.insertText('Juniper shook his mane.');
  await tick(300);
  assert.equal(await js(`canonSlips.length`), 0); // nothing while typing
  await until(`canonSlips.some((s) => s.quiet && s.span === 'his' && s.sentence === 'Juniper shook his mane.')`, 8000);
  assert.equal(await js(`CSS.highlights.get('neo-slip').size`), 1);
  await tick(200);
  await shot('tutorial-quiet-check.png');
  // the impatient way: ⌘' finds it as well
  key("'", [CMD]);
  await until(`canonPassOn && canonProgress === '' && canonSlips.some((s) => s.sentence === 'Juniper shook his mane.')`, 9000);
  key("'", [CMD]);
  await until(`!canonPassOn`);
  // done with it: the sentence goes, as the lesson says
  await js(`(() => { const ps = document.querySelectorAll('.chapter[data-id="c3"] .chapter-body p'); const p = ps[ps.length - 1]; const body = p.closest('.chapter-body'); p.remove(); syncChapter(body, 'c3'); })()`);
});

part('tutorial', 'lessons 7 and 8, no reader: Juniper made a stallion through a review list; a link to Odile Fenn makes her entry', async () => {
  await openStory('canon');
  await js(`(() => { const e = canon.entries.get('juniper').data; const old = e.facts.find((f) => f.attr === 'sex'); canonChangeAcross('juniper', Canon.handFact('Sex: stallion'), old); })()`);
  await until(`canonReview && !canonReview.loading && canonReview.items.length > 0`);
  assert.ok(await js(`canonReview.items.some((x) => x.span === 'her' && x.to === 'his')`));
  await js(`[...[...document.querySelectorAll('#canon-side .cs-review')][0].querySelectorAll('button')].find((b) => b.textContent === 'Apply').click()`);
  await until(`canonReview.items[0].state === 'applied'`);
  // ⌘Z from the Canon tab: the words go back, and the card says so again
  await js(`switchTab('canon')`);
  await js(`structuralUndo()`);
  await until(`canonReview.items[0].state === 'todo'`);
  if (await js(`currentTab !== 'manuscript'`)) await js(`switchTab('manuscript')`);
  await js(`[...document.querySelectorAll('#canon-side button')].find((b) => b.textContent === 'Stop Reviewing').click()`);
  await until(`!canonReview`);
  await js(`switchTab('canon')`);
  await js(`canonEdit('wren-calloway', (d) => { d.words = 'Carries a letter for [[Odile Fenn]].\\n'; })`);
  await js(`canonGo('wren-calloway')`);
  await until(`!!document.querySelector('#canon-view .cn-words .cn-link.cn-unresolved')`);
  await js(`document.querySelector('#canon-view .cn-words .cn-link.cn-unresolved').click()`);
  await until(`[...document.querySelectorAll('.pop-menu button')].some((b) => b.textContent === 'Make an entry for “Odile Fenn”')`);
  await js(`[...document.querySelectorAll('.pop-menu button')].find((b) => b.textContent === 'Make an entry for “Odile Fenn”').click()`);
  await until(`[...document.querySelectorAll('.pop-menu .pm-title')].some((x) => x.textContent === 'What is Odile Fenn?')`);
  await menuPick('Person');
  await until(`[...canon.entries.values()].some((x) => x.data && x.data.name === 'Odile Fenn')`);
});

part('tutorial', 'lesson 9, no reader: ⌘K "bay mare" finds Juniper; the World Map has Ballast and Hesketh', async () => {
  await openStory();
  await until2(() => key('K', [CMD]), `!!go`);
  wc.insertText('bay mare');
  await until(`(${goRows}[0] || '') === 'Juniper | Entry'`);
  key('Escape');
  await until(`!go`);
  wc.send('menu', { type: 'worldMap' });
  await until(`!!document.querySelector('#map-view') && NeoMap.nodes().length > 0`);
  const ids = await js(`NeoMap.nodes().map((d) => d.id)`);
  assert.ok(ids.includes('ballast') && ids.includes('hesketh'), ids.join());
  await js(`mapClose()`);
});

part('tutorial', 'lesson 10: Needs You asks about Hesketh\'s mule with no reader; Read the Shelf\'s part says it needs the reader, with its button', async () => {
  assert.match(await lessonText(10), /This one needs the reader\. Not got it yet\? <a href="neo:reader">Download the reader<\/a>/);
  await openStory('canon');
  await js(`canonShown = null; renderCanon()`);
  await until(`[...document.querySelectorAll('#canon-side .cs-need strong')].some((x) => /^Hesketh says Juniper/.test(x.textContent))`);
  await js(`[...document.querySelectorAll('#canon-side .cs-need button')].find((b) => b.textContent === 'Only what’s said').click()`);
  await until(`!canon.entries.get('juniper').data.facts.some((f) => f.value === 'mule')`);
});

part('tutorial', 'the Canon tab on a book whose shelf keeps none: the explainer, Keep a Canon for “Works in Progress”, the Tutorial', async () => {
  const id = await js(`(async () => { const b = await window.neo.createBook({ title: 'My Novel' }); library.shelves[0].bookIds.push(b.id); await writeLibrary(library); return b.id; })()`);
  await js(`openBook('${id}')`);
  await until(`book && book.id === '${id}'`);
  await js(`switchTab('canon')`);
  await until(`!!document.querySelector('#canon-view .cn-invite')`);
  assert.equal(await js(`document.querySelector('.cn-invite .cn-offer').textContent`), 'Keep a Canon for “Works in Progress”');
  assert.equal(await js(`document.querySelectorAll('.cn-invite .cn-offer').length`), 2); // (and Move… to a shelf of its own)
  await tick(300);
  await shot('canon-tab-no-canon.png');
  await theme('light');
  await shot('canon-tab-no-canon-light.png');
  await theme('night');
  // its link: the Tutorial again, the same shelf, nothing copied twice
  const before = fs.readdirSync(LIB).filter((d) => /^(book|canon)-/.test(d)).length;
  await js(`document.querySelector('.cn-invite .cn-tutorial button').click()`);
  await until(`book && book.id === ${tutorialShelf}.tutorial[0]`);
  assert.equal(await js(`library.shelves.filter((s) => s.tutorial).length`), 1);
  assert.equal(fs.readdirSync(LIB).filter((d) => /^(book|canon)-/.test(d)).length, before);
});

part('tutorial', 'Start the Tutorial Afresh: a clean copy, the old one set aside with its words', async () => {
  const old = await js(tutorialShelf);
  const c1 = path.join(LIB, old.tutorial[1], 'chapters', 'c1.html');
  fs.writeFileSync(c1, '<p>A line of my own.</p>');
  wc.send('menu', { type: 'tutorial', afresh: true });
  await until(`!!document.querySelector('.modal-backdrop:not(#firstrun) .fr-choice')`);
  await js(`document.querySelector('.modal-backdrop:not(#firstrun) .fr-choice').click()`);
  await until(`${tutorialShelf}.id !== '${old.id}' && book && book.id === ${tutorialShelf}.tutorial[0]`);
  assert.equal(await js(`library.shelves.filter((s) => s.tutorial).length`), 1);
  assert.equal(await js(`library.shelves.some((s) => s.bookIds.includes('${old.tutorial[1]}'))`), false);
  assert.equal(fs.readFileSync(c1, 'utf8'), '<p>A line of my own.</p>'); // set aside, never thrown away
  assert.ok(fs.existsSync(path.join(LIB, old.canonId, 'canon.json')));
});

const UNDER = 'book-under-the-line-wh1';
part('editor', 'Read the Shelf, the editor\'s way: who and what is here, then each one read about, facts checked, profiles written; the line says which', async () => {
  if (!(await js(`$('#firstrun').hidden`))) { await js(`document.querySelector('#firstrun .fr-choice').click()`); await until(`!$('#fr-step2').hidden`); await js(`$('#fr-done').click()`); }
  await js(`openBook('${UNDER}')`);
  await until(`book && book.id === '${UNDER}'`);
  await js(`switchTab('canon'); canonShown = null; renderCanon()`);
  await until(`!!canon && !!canon.reader && canon.reader.installed === 'careful'`);
  await tick(1200); // (the book's opening tip, out of the screenshots)
  await js(`clearTimeout(toast._t); $('#hint').hidden = true`);
  if (REAL_RUN) return;
  await js(`setTimeout(() => canonReadShelfNow(), 0); 0`); // (not awaited: the line is watched as it goes)
  const seen = new Set();
  for (const end = Date.now() + 60000; Date.now() < end && !(await js(`!canonReading && /found/.test(canonReadLine)`)); await tick(60)) {
    const line = await js(`document.querySelector('#canon-view .cn-read-line')?.textContent || ''`);
    for (const [k, re] of [['cast', /^Finding who and what is here…/], ['dossier', /^Reading about \S.* \(\d+ of \d+\) · Under the Line, Ch 1/], ['verify', /^Checking facts… \(\d+ of \d+\)/], ['events', /^Noting what happens…/], ['profile', /^Writing profiles…/]]) {
      if (re.test(line) && !seen.has(k)) {
        seen.add(k);
        if (k === 'dossier') { await js(`$('#nav-pane').classList.add('open')`); await shot('editor-reading.png'); }
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['cast', 'dossier', 'events', 'profile', 'verify']);
  assert.match(await js(`canonReadLine`), /^Canon found \d+ entries and \d+ facts\./);
});

part('editor', 'an entry\'s page: the profile, each source a number that opens its passage; then the facts in sections, each with its quote', async () => {
  await js(`canonShown = 'hesper'; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-entry .cn-profile-text')`);
  if (!REAL_RUN) {
    assert.equal(await js(`document.querySelector('.cn-profile-text').textContent`), 'Hesper is fifteen and the tallest girl in her year.1 Her hair is fair as wet straw.2');
    assert.deepEqual(await js(`[...document.querySelectorAll('.cn-profile .cn-cite')].map((b) => b.title)`), ['Under the Line, Ch 1: “Hesper was fifteen and the tallest girl in her year”', 'Under the Line, Ch 1: “Her hair was cropped close to the skull and fair as wet straw.”']);
    assert.equal(await js(`document.querySelector('.cn-profile .cn-by').textContent`), 'Canon’s profile');
    assert.deepEqual(await js(`[...document.querySelectorAll('#canon-view .cn-group')].map((h) => h.textContent)`), ['Who they are', 'Appearance', 'Habits and routines', 'Origin and history']);
    // what the warden says ("too tall") is below the facts, never among them, and never asked
    assert.match(await js(`document.querySelector('#canon-view .cn-sub').nextElementSibling.textContent`), /Height: too tall/);
    assert.ok(!(await js(`canonNeeds().some((x) => x.f.attr === 'other')`)));
  }
  await js(`$('#nav-pane').classList.add('open'); $('#side-pane').classList.add('open')`);
  await tick(400);
  await shot('editor-entry-person.png');
  await js(`canonShown = 'weighhouse'; renderCanon()`);
  await until(`document.querySelector('#canon-view .cn-name')?.textContent === 'the Weighhouse'`);
  if (!REAL_RUN) assert.deepEqual(await js(`[...document.querySelectorAll('#canon-view .cn-group')].map((h) => h.textContent)`), ['How it works', 'Rules']);
  await tick(300);
  await shot('editor-entry-place.png');
  if (REAL_RUN) {
    for (const id of ['long-room', 'coll', 'anselm', 'warden', 'spared']) {
      if (!(await js(`!!canon.entries.get('${id}')`))) continue;
      await js(`canonShown = '${id}'; renderCanon()`);
      await tick(300);
      await shot(`editor-entry-${id}.png`);
    }
    return;
  }
  // a source number opens its passage, lit in the chapter
  await js(`canonShown = 'hesper'; renderCanon()`);
  await until(`!!document.querySelector('.cn-profile .cn-cite')`);
  await js(`document.querySelector('.cn-profile .cn-cite').click()`);
  await until(`currentTab === 'manuscript'`);
});

part('editor', 'the pass on an open fact: "high windows" against "not one window", its popover with no swap; the infirmary\'s window is no slip', async () => {
  if (REAL_RUN) return;
  await js(`switchTab('manuscript'); toggleContinuity()`);
  await until(`canonProgress === '' && canonSlips.some((s) => s.kind === 'open')`, 20000);
  assert.ok(!(await js(`canonSlips.some((s) => /infirmary|feast days/.test(s.sentence))`)));
  const open = `canonSlips.find((s) => s.kind === 'open')`;
  assert.deepEqual(await js(`[${open}.span, ${open}.range.toString(), ${open}.to]`), ['high windows', 'high windows', null]);
  await js(`(() => { const s = ${open}; s.range.startContainer.parentElement.scrollIntoView({ block: 'center' }); const r = s.range.getBoundingClientRect(); canonPopOpen(s, r.left, r.bottom + 6); })()`);
  await until(`!!document.querySelector('.canon-pop .cp-claim')`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-claim').textContent`), 'Canon has the Long Room · Description: not one window.');
  assert.equal(await js(`document.querySelector('.canon-pop .cp-why').textContent`), 'Here it says “high windows”.');
  assert.ok(!(await js(`!!document.querySelector('.canon-pop .cp-swap')`)));
  await tick(200);
  await shot('editor-open-slip.png');
  await js(`[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Not a slip').click()`);
  await until(`!canonSlips.some((s) => s.kind === 'open' && s.range)`);
  const not = JSON.parse(fs.readFileSync(path.join(LIB, 'canon-the-weighhouse-shelf-wh', 'not-slips.json'), 'utf8'));
  assert.ok(not.some((n) => n.fact === 'long-room/other/description/not-one-window'));
});

part('relaunch', 'NEO opened again: the welcome, answered, never shows; the Tutorial is still there', async () => {
  await tick(1500);
  assert.equal(await js(`!!$('#welcome')`), false);
  assert.equal(await js(`library.shelves.filter((s) => s.tutorial).length`), 1);
  assert.equal(settings().canonWelcome, true);
});

/* ---------- runner ---------- */

async function main() {
  await serving;
  const url = `http://127.0.0.1:${server.address().port}/reader.gguf`;
  const sha256 = crypto.createHash('sha256').update(MODEL).digest('hex');
  fs.writeFileSync(readersFile, JSON.stringify({
    careful: { file: 'careful.gguf', size: MODEL.length, sha256, url, licence: 'Apache-2.0', ...(PART === 'editor' ? { editor: true } : {}) },
    quick: { file: 'quick.gguf', size: MODEL.length, sha256, url, licence: 'Apache-2.0' }
  }));
  await app.whenReady();
  let failed = 0;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    if (process.env.CANON_DEBUG) wc.on('console-message', (e) => console.log('renderer:', e.message, e.lineNumber));
    win.setSize(1400, 900);
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    win.focus();
    if (process.env.CANON_LIGHT) await theme('light'); // screenshots in the light theme
    const run = PART ? parts.filter((x) => x.which === PART) : tests.slice(0, +process.env.CANON_UPTO || tests.length);
    for (const t of run) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${run.length - failed} passed, ${failed} failed${PART ? ' (' + PART + ')' : ''}`);
    // then a fresh computer, in NEOs of their own: the welcome, the Tutorial, a relaunch
    if (!PART && !process.env.CANON_UPTO) {
      const fresh = fs.mkdtempSync(path.join(os.tmpdir(), `neo-canon-test-${process.pid}-fresh-`));
      for (const which of ['tutorial', 'relaunch', 'editor']) {
        const r = require('child_process').spawnSync(process.execPath, [...process.argv.slice(1).filter((a) => a.startsWith('--')), __filename],
          { env: { ...process.env, NEO_E2E_PART: which, NEO_E2E_TMP: which === 'editor' ? fs.mkdtempSync(path.join(os.tmpdir(), `neo-canon-test-${process.pid}-editor-`)) : fresh }, stdio: 'inherit' });
        if (r.status !== 0) failed++;
      }
    }
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    server.close();
    app.exit(failed ? 1 : 0);
  }
}
main();

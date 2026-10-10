// End-to-end tests for Canon on a copy of the Ashfall Road fixture.
// Run with `npm run test:canon` (xvfb-run -a npx electron --no-sandbox
// scripts/canon.e2e.js where there's no display). With CANON_SHOTS=1,
// screenshots of the tab, a slip's popover, the reader's download, Read the
// Shelf at work, the review of a change and a notebook go to
// docs/semantics/screens/ (without it, nothing tracked is written).

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-canon-test-${process.pid}-`));
const LIB = path.join(tmp, 'NEO Library');
const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
fs.cpSync(path.join(FIXTURE, 'library'), LIB, { recursive: true });
// the shelf starts without a Canon: the test keeps one, as a writer would
const libFile = path.join(LIB, 'library.json');
const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
delete lib.shelves[0].canonId;
fs.writeFileSync(libFile, JSON.stringify(lib));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
process.env.NEO_CANON_FAKE = path.join(FIXTURE, 'reader-answers.json');
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
    res.write(MODEL.subarray(at, at + 600000));
    at += 600000;
    setTimeout(send, 50);
  };
  send();
});
const serving = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const readersFile = path.join(tmp, 'readers.json');
process.env.NEO_CANON_READERS = readersFile;
const SCREENS = path.join(__dirname, '..', 'docs', 'semantics', 'screens');
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
  throw new Error('timed out waiting for ' + code);
};
const shot = async (name) => {
  const want = process.env.CANON_SHOTS; // 1 for all, or a part of the names wanted
  if (!want || (want !== '1' && !want.split(',').some((w) => name.includes(w)))) return;
  fs.mkdirSync(SCREENS, { recursive: true });
  await js(`$('#hint').hidden = true`); // a toast left from a step before
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(SCREENS, name), img.toPNG());
};
const SALT = 'book-the-salt-crown-salt2';
const CANON = 'canon-the-ashfall-road-shelf-ash';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a shelf without a Canon: no Canon tab', async () => {
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  assert.equal(await js(`$('.tab[data-tab="canon"]').hidden`), true);
  assert.equal(await js(`[...document.querySelectorAll('.tab')].filter((t) => !t.hidden).length`), 4);
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

let tier;
test('no reader on this computer: the Canon tab offers one button to get it', async () => {
  await js(`canonShown = null; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-setup .cn-download')`);
  assert.equal(await js(`document.querySelector('#canon-view .cn-read')`), null);
  // picked from this computer's memory: 16 GB and up the careful reader
  tier = await js(`canon.reader.recommend`);
  const [best, other] = tier === 'careful' ? ['Careful', 'Quick'] : ['Quick', 'Careful'];
  assert.equal(await js(`document.querySelector('.cn-setup .cn-pick').textContent`), `Recommended for this computer: ${best} reader · 0.1 GB`);
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
  await js(`[...document.querySelectorAll('.cn-setup button')].find((b) => b.textContent === 'Resume').click()`);
  await until(`!!document.querySelector('#canon-view .cn-ready')`, 20000);
  assert.equal(await js(`document.querySelector('#canon-view .cn-ready').textContent`), 'The reader is ready.');
  assert.equal(ranges.length, 2);
  assert.ok(ranges[1] >= part); // picked up from the .part
  assert.equal(fs.statSync(path.join(tmp, 'app', 'models', tier + '.gguf')).size, MODEL.length);
  assert.equal(await js(`canon.reader.installed`), tier);
});

test('Read the Shelf (the fake reader): progress, a pause while typing, then entries, facts and Needs You', async () => {
  process.env.NEO_CANON_FAKE_MS = '120';
  await until(`!!document.querySelector('#canon-view .cn-read')`);
  assert.match(await js(`document.querySelector('#canon-view .cn-home').textContent`), /Canon will read 2 books and 1 notebook \([\d,]+ words\)/);
  await js(`document.querySelector('#canon-view .cn-read').click()`);
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
  assert.equal(await js(`canonReadLine`), 'Canon found 7 entries and 17 facts. 15 checked out; 2 need you.');
  assert.equal(fs.readdirSync(path.join(LIB, CANON, 'entries')).filter((f) => f.endsWith('.md')).length, 7);
  assert.deepEqual(await js(`[...document.querySelectorAll('#nav-list .cn-kind-head')].map((x) => x.textContent)`), ['People', 'Creatures', 'Places']);
  // the writer's own fact stayed theirs, and gained the passages that agree
  const bramble = fs.readFileSync(path.join(LIB, CANON, 'entries', 'bramble.md'), 'utf8');
  assert.match(bramble, /- Sex: female \(mare\) · yours\n {2}- Written in Canon\n {2}- Ember and Thorn, Ch 2: "Bramble, the grey mare, would not cross the ford\." \{book:book-ember-and-thorn-ember1, ch:c2\}/);
  await js(`canonShown = 'bramble'; renderCanon()`);
  await until(`document.querySelectorAll('#canon-side .cs-need').length === 2`);
  assert.equal(await js(`$('#side-pane').classList.contains('open')`), true);
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(400);
  await shot('canon-tab.png');
  // a source in a book's Notes opens Notes with the quote lit
  await js(`[...document.querySelectorAll('#canon-side .cs-where-btn')].find((b) => /Notes/.test(b.textContent)).click()`);
  await until(`currentTab === 'notes' && CSS.highlights.has('neo-canon-quote')`);
  assert.equal(await js(`[...CSS.highlights.get('neo-canon-quote')][0].toString()`), 'Bramble is in foal by the end of book 2?');
  await js(`switchTab('canon')`);
});

const chapterFiles = () => ['c1', 'c2', 'c3'].map((c) => fs.readFileSync(path.join(LIB, SALT, 'chapters', c + '.html'), 'utf8'));
let before;

test('Continuity Pass: five marks, listed in the right-hand pane, none of it in the chapter', async () => {
  before = chapterFiles();
  await js(`switchTab('manuscript'); toggleContinuity()`);
  await until(`canonProgress === '' && canonSlips.length >= 5`);
  await until(`CSS.highlights.get('neo-slip') && CSS.highlights.get('neo-slip').size === 5`);
  assert.deepEqual(await js(`canonSlips.map((s) => s.range.toString())`), ['his', 'brown', 'elder', 'Corwyck', 'stallion']);
  assert.equal(await js(`document.querySelectorAll('#canon-side .cs-slip').length`), 5);
  assert.equal(await js(`$('#side-pane').classList.contains('open')`), true);
  const saved = await js(`[...document.querySelectorAll('.chapter-body')].map((b) => captureBody(b)).join('')`);
  assert.ok(!/slip|canon/i.test(saved));
  assert.deepEqual(chapterFiles(), before);
});

test('hovering a mark opens its popover', async () => {
  const at = await js(`(() => { const r = canonSlips[0].range.getBoundingClientRect(); r.startContainer; canonSlips[0].range.startContainer.parentElement.scrollIntoView({ block: 'center' }); const q = canonSlips[0].range.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`);
  const zoom = await js(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1`);
  wc.sendInputEvent({ type: 'mouseMove', x: Math.round(at[0] * zoom), y: Math.round(at[1] * zoom) });
  await until(`!!document.querySelector('.canon-pop')`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-claim').textContent`), 'Bramble is a mare.');
  assert.match(await js(`document.querySelector('.canon-pop').textContent`), /Keep: mare.*Not a slip/);
  await shot('canon-slip-popover.png');
});

test('Keep: mare shows the change, Apply makes it as one undoable edit', async () => {
  await js(`document.querySelector('.canon-pop .cp-main').click()`);
  assert.equal(await js(`document.querySelector('.canon-pop .cp-change').textContent`), 'his her');
  await js(`document.querySelector('.canon-pop .cp-main').click()`);
  const para = `[...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((p) => p.textContent.includes('tossed')).textContent`;
  assert.match(await js(para), /Bramble tossed her head/);
  assert.equal(await js(`CSS.highlights.get('neo-slip').size`), 4);
  assert.equal(await js(`document.querySelectorAll('#canon-side .cs-slip').length`), 4);
  // ⌘Z brings the words back, and the mark and the list with them
  await js(`document.execCommand('undo')`);
  assert.match(await js(para), /Bramble tossed his head/);
  await until(`CSS.highlights.get('neo-slip').size === 5 && document.querySelectorAll('#canon-side .cs-slip').length === 5`);
  assert.match(await js(`document.querySelector('#canon-side .cs-slip q').textContent`), /^Bramble tossed his head and pulled$/);
});

test('Not a slip is remembered against the sentence', async () => {
  await js(`canonPopOpen(canonSlips.find((s) => s.span === 'brown'), 300, 300)`);
  await js(`[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Not a slip').click()`);
  await until(`canonSlips.length === 4`);
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
  const now = `[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Bramble is now a stallion…')`;
  assert.equal(await js(`!!${now}`), true);
  await js(`${now}.click()`);
  assert.match(await js(`document.querySelector('.canon-pop .cp-ask').textContent`), /^Bramble is a stallion\. Canon will find every passage that says otherwise/);
  await js(`[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Find Passages').click()`);
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
  // the rest: Apply All Shown, there once the whole list has been seen
  await js(`${items}.at(-1).scrollIntoView()`);
  await until(`[...document.querySelectorAll('#canon-side button')].some((b) => b.textContent === 'Apply All Shown')`);
  await js(`[...document.querySelectorAll('#canon-side button')].find((b) => b.textContent === 'Apply All Shown').click()`);
  await until(`!canonReview.items.some((x) => x.state === 'todo')`);
  assert.equal(await js(`document.querySelector('#canon-side .cs-done').textContent`), '4 passages changed, 0 skipped. Bramble is a stallion.');
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
  await until(`/Dismissed \\(2\\)/.test(document.querySelector('#canon-side .cs-dismissed-head')?.textContent)`);
  await js(`document.querySelector('#canon-side .cs-dismissed-head').click()`);
  await until(`document.querySelectorAll('#canon-side q.cs-src').length === 2`);
  assert.match(await js(`document.querySelector('#canon-side').textContent`), /Ilsa Varr · Eyes.*Ilsa’s eyes looked almost brown in the firelight\./);
  await js(`[...document.querySelectorAll('#canon-side .cs-row button')].filter((b) => b.textContent === 'Restore').at(-1).click()`);
  await until(`/Dismissed \\(1\\)/.test(document.querySelector('#canon-side .cs-dismissed-head')?.textContent)`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, CANON, 'not-slips.json'), 'utf8')).length, 1);
  assert.equal(await js(`!!document.querySelector('#canon-view .cn-again')`), true);
});

/* ---------- the writer's IDE (docs/semantics/IDE.md) ---------- */

const ENTRIES = path.join(LIB, CANON, 'entries');
const libStamps = () => {
  const out = {};
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else out[p] = fs.statSync(p).mtimeMs; } };
  walk(LIB);
  return out;
};
const backs = `[...document.querySelectorAll('#canon-view .cn-backs')].map((b) => b.textContent)`;

test('links: a rule entry, [[links]] set as links, Linked from both ways, a rename that keeps them', async () => {
  fs.copyFileSync(path.join(FIXTURE, 'ide', 'the-salt-laws.md'), path.join(ENTRIES, 'the-salt-laws.md'));
  await js(`canonRefreshNow()`);
  await until(`canon.entries.has('the-salt-laws')`);
  await until(`[...document.querySelectorAll('#nav-list .cn-kind-head')].some((x) => x.textContent === 'Rules and Systems')`);
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
test('In this chapter: the right-hand pane lists who and what the chapter names, the caret\'s in the accent', async () => {
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}'`);
  await js(`switchTab('manuscript')`);
  // the caret in Bramble's paragraph of Ch 1
  await js(`(() => { const p = [...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((x) => x.textContent.includes('did not like the convoy')); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.setStart(p.firstChild, 3); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 400 });
  wc.sendInputEvent({ type: 'mouseMove', x: SIDE_X, y: 400 });
  await until(`$('#side-pane').classList.contains('open') && !!document.querySelector('#canon-here .ch-name')`);
  const names = await js(`[...document.querySelectorAll('#canon-here .ch-name')].map((b) => b.textContent + (b.classList.contains('here') ? '*' : ''))`);
  assert.equal(await js(`document.querySelector('#canon-here .ch-title').textContent`), 'In this chapter');
  assert.ok(names.includes('Bramble*') && names.includes('Ilsa Varr'), names.join());
  assert.deepEqual(await js(`[...document.querySelectorAll('#canon-here .ch-kind')].map((k) => k.textContent)`), ['People', 'Creatures', 'Places']);
  const bramble = `[...document.querySelectorAll('#canon-here .ch-name')].find((b) => b.textContent === 'Bramble')`;
  await js(`${bramble}.dispatchEvent(new MouseEvent('mouseenter'))`);
  assert.equal(await js(`document.querySelector('#canon-here .ch-facts').textContent`), 'horse · Tamsin Hale · stallion');
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
  key('K', [CMD]);
  await until(`!!document.querySelector('.go-box .go-input') && document.activeElement === document.querySelector('.go-input')`);
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
  key('K', [CMD]);
  await until(`!!go`);
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
  key('K', [CMD]);
  await until(`!!go`);
  wc.insertText('snapshot');
  await until(`(${goRows}[0] || '') === 'Take Snapshot | Command'`);
  key('Return');
  await until(`/Snapshot taken|Nothing has changed since your last snapshot/.test($('#hint').textContent)`);
  assert.ok(snaps() >= n);
  // a shelf without a Canon: chapters, passages and commands only
  await js(`stopCanon(library.shelves[0])`);
  await js(`canonTabUpdate()`);
  key('K', [CMD]);
  await until(`!!go`);
  wc.insertText('bramble');
  await until(`${goRows}.some((r) => / \\| Passage$/.test(r))`);
  const groups = new Set((await js(goRows)).map((r) => r.split(' | ')[1].replace(/^.*?(Chapter|Passage|Command)$/, '$1')));
  assert.deepEqual([...groups].filter((g) => !['Chapter', 'Passage', 'Command'].includes(g)), []);
  key('Escape');
  await until(`!go`);
  await js(`library.shelves[0].canonId = '${CANON}'; writeLibrary(library).then(() => canonTabUpdate())`);
});

/* ---------- runner ---------- */

async function main() {
  await serving;
  const url = `http://127.0.0.1:${server.address().port}/reader.gguf`;
  const sha256 = crypto.createHash('sha256').update(MODEL).digest('hex');
  fs.writeFileSync(readersFile, JSON.stringify({
    careful: { file: 'careful.gguf', size: MODEL.length, sha256, url, licence: 'Apache-2.0' },
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
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    server.close();
    app.exit(failed ? 1 : 0);
  }
}
main();

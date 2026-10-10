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
  if (!process.env.CANON_SHOTS) return;
  fs.mkdirSync(SCREENS, { recursive: true });
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

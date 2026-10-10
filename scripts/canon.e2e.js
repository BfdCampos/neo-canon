// End-to-end tests for Canon on a copy of the Ashfall Road fixture.
// Run with `npm run test:canon` (xvfb-run -a npx electron --no-sandbox
// scripts/canon.e2e.js where there's no display). Screenshots of the tab and
// a slip's popover go to docs/semantics/screens/.

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

test('Read the Shelf (the fake reader): entries, facts and Needs You', async () => {
  await js(`canonShown = null; renderCanon()`);
  await until(`!!document.querySelector('#canon-view .cn-read')`);
  await js(`document.querySelector('#canon-view .cn-read').click()`);
  await until(`!canonReading && /found/.test(canonReadLine)`, 20000);
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
  await js(`document.execCommand('undo')`);
  assert.match(await js(para), /Bramble tossed his head/);
});

test('Not a slip is remembered against the sentence', async () => {
  await js(`canonPopOpen(canonSlips.find((s) => s.span === 'brown'), 300, 300)`);
  await js(`[...document.querySelectorAll('.canon-pop button')].find((b) => b.textContent === 'Not a slip').click()`);
  await until(`canonSlips.length === 3`);
  const notSlips = JSON.parse(fs.readFileSync(path.join(LIB, CANON, 'not-slips.json'), 'utf8'));
  assert.deepEqual(notSlips.map((n) => n.fact), ['ilsa-varr/eyes', 'ilsa-varr/eyes']);
  assert.equal(notSlips[1].text, 'Ilsa’s brown eyes narrowed.');
});

test('toggling the pass off clears every mark', async () => {
  await js(`toggleContinuity()`);
  assert.equal(await js(`CSS.highlights.has('neo-slip')`), false);
  assert.equal(await js(`$('#editor-view').classList.contains('canon-side')`), false);
});

/* ---------- runner ---------- */

async function main() {
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
    app.exit(failed ? 1 : 0);
  }
}
main();

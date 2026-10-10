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

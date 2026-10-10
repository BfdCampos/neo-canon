// Records the README demo of NEO Canon: docs/semantics/demo/neo-canon-demo.{mp4,gif}.
// Run with
//   xvfb-run -a -s "-screen 0 1440x900x24" npx electron --no-sandbox scripts/demo.record.js
// It drives the app on a copy of the Ashfall Road fixture with real input events
// (webContents.sendInputEvent), the fake reader (NEO_CANON_FAKE) and a shortened
// quiet-check timeout and resume (NEO_CANON_QUIET_MS, NEO_CANON_RESUME_MS), grabs frames with capturePage() and
// lets ffmpeg make the mp4 and the gif. Captions are a temporary DOM element in
// the window, only for the recording; nothing tracked is written but the output.
// DEMO_KEEP=1 keeps the frames; DEMO_OUT sets another output folder.

'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-canon-demo-${process.pid}-`));
const LIB = path.join(tmp, 'NEO Library');
const FIXTURE = path.join(__dirname, 'fixtures', 'canon');
const OUT = process.env.DEMO_OUT || path.join(__dirname, '..', 'docs', 'semantics', 'demo');
const FRAMES = path.join(tmp, 'frames');
fs.cpSync(path.join(FIXTURE, 'library'), LIB, { recursive: true });
fs.mkdirSync(FRAMES, { recursive: true });
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
process.env.NEO_CANON_FAKE = path.join(FIXTURE, 'reader-answers.json');
process.env.NEO_CANON_QUIET_MS = '2500'; // the 90 s pause, shortened for the film
process.env.NEO_CANON_RESUME_MS = '1500'; // and the reader's 10 s wait after a key, so the check plays in real time
// a stand-in reader file, so Canon has a reader installed without a download
const MODEL = Buffer.alloc(1024, 7);
const readersFile = path.join(tmp, 'readers.json');
process.env.NEO_CANON_READERS = readersFile;
fs.writeFileSync(readersFile, JSON.stringify({
  careful: { file: 'careful.gguf', size: MODEL.length, sha256: 'x', url: 'http://127.0.0.1:9/none', licence: 'Apache-2.0' }
}));
fs.mkdirSync(path.join(tmp, 'app', 'models'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'app', 'models', 'careful.gguf'), MODEL);

const SALT = 'book-the-salt-crown-salt2';
// the fixture's c1 already slips ("tossed his head"); the film types its own slip
const c1 = path.join(LIB, SALT, 'chapters', 'c1.html');
fs.writeFileSync(c1, fs.readFileSync(c1, 'utf8').replace('tossed his head', 'tossed her head'));

const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let win;
let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (code, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await tick(50)) if (await js(code)) return true;
  throw new Error('timed out waiting for ' + code);
};

/* ---------- frames ---------- */

let recording = false;
const frames = []; // { file, t }
let t0 = 0;
async function grab() {
  while (recording) {
    const started = Date.now();
    try {
      const img = await wc.capturePage();
      const file = path.join(FRAMES, String(frames.length).padStart(5, '0') + '.jpg');
      fs.writeFileSync(file, img.toJPEG(92));
      frames.push({ file, t: started - t0 });
    } catch { /* a frame lost */ }
    await tick(Math.max(0, 70 - (Date.now() - started)));
  }
}

/* ---------- captions ---------- */

const cap = (text) => js(`(() => {
  let c = document.getElementById('demo-cap');
  if (!c) {
    c = document.createElement('div');
    c.id = 'demo-cap';
    c.style.cssText = 'position:fixed;left:50%;top:26px;transform:translateX(-50%);max-width:70vw;padding:11px 22px;border-radius:10px;background:rgba(18,18,22,.82);color:#f3efe6;font:500 21px/1.35 system-ui,sans-serif;letter-spacing:.01em;text-align:center;z-index:99999;pointer-events:none;transition:opacity .35s;opacity:0;box-shadow:0 4px 18px rgba(0,0,0,.35)';
    document.body.appendChild(c);
  }
  const text = ${JSON.stringify(text)};
  if (text) c.textContent = text;
  c.style.opacity = text ? '1' : '0';
})()`);

/* ---------- human input ---------- */

let mouse = { x: 720, y: 450 };
const zoomOf = () => js(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1`);
async function moveTo(x, y, ms = 700) {
  const z = await zoomOf();
  const from = mouse;
  const steps = Math.max(6, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round((from.x + (x - from.x) * e) * z), y: Math.round((from.y + (y - from.y) * e) * z) });
    await tick(16);
  }
  mouse = { x, y };
}
async function click(x, y, ms = 700) {
  await moveTo(x, y, ms);
  const z = await zoomOf();
  const p = { x: Math.round(x * z), y: Math.round(y * z), button: 'left', clickCount: 1 };
  wc.sendInputEvent({ type: 'mouseDown', ...p });
  await tick(70);
  wc.sendInputEvent({ type: 'mouseUp', ...p });
  await tick(150);
}
const centre = (sel) => js(`(() => { const e = ${sel}; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const clickOn = async (sel, ms) => { const c = await centre(sel); await click(c.x, c.y, ms); };
async function type(text, pace = 95) {
  for (const ch of text) {
    const keyCode = ch === ' ' ? 'Space' : ch.toUpperCase();
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(pace + Math.round(Math.random() * 60));
  }
}
const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); };
const CMD = process.platform === 'darwin' ? 'meta' : 'control';
// input sent to a window that's busy settling can be lost: send it again until it lands
const until2 = async (send, code, tries = 4) => {
  for (let i = 0; i < tries; i++) {
    send();
    try { return await until(code, 2000); } catch (err) { if (i === tries - 1) throw err; }
  }
};

/* ---------- the story ---------- */

async function prepare() {
  // off camera: Canon reads the shelf once, so there is a Canon to show
  await js(`openBook('${SALT}')`);
  await until(`book && book.id === '${SALT}' && canon && canon.reader && canon.reader.installed`);
  await js(`canonReadShelfNow()`);
  await until(`!canonReading && /found/.test(canonReadLine)`, 60000);
  await js(`backToShelf()`);
  await until(`!$('#bookshelf-view').hidden && !!document.querySelector('.book[data-book-id="${SALT}"]')`);
  await js(`$('#hint').hidden = true`);
}

async function story() {
  await tick(400);
  await js(`$('#hint').hidden = true`);
  await cap('The Ashfall Road: three books, one world.');
  await moveTo(720, 520, 900);
  await tick(2800);

  // 1. open the book
  await cap('');
  await clickOn(`document.querySelector('.book[data-book-id="${SALT}"]')`, 1100);
  await until(`book && book.id === '${SALT}' && !$('#editor-view').hidden`);
  await tick(600);
  await js(`$('#hint').hidden = true`);
  await tick(800);

  // 2. the Canon tab, Bramble's entry
  await cap('Bramble is a mare — it says so in Chapter 2 and in your notes.');
  await clickOn(`document.querySelector('.tab[data-tab="canon"]')`, 900);
  await until(`currentTab === 'canon'`);
  await js(`$('#nav-pane').classList.add('open')`);
  await tick(900);
  await clickOn(`[...document.querySelectorAll('#nav-list .cn-item')].find((x) => x.textContent.includes('Bramble'))`, 900);
  await until(`canonShown === 'bramble' && !!document.querySelector('#canon-view .cn-fact')`);
  await tick(4200);
  await js(`document.querySelector('#canon-view').scrollTop = 120`);
  await tick(2200);
  await js(`document.querySelector('#canon-view').scrollTop = 0`);
  await tick(600);

  // 3. back to the manuscript; a sentence typed slowly
  await cap('');
  await js(`$('#nav-pane').classList.remove('open')`);
  await clickOn(`document.querySelector('.tab[data-tab="manuscript"]')`, 900);
  await until(`currentTab === 'manuscript'`);
  await tick(500);
  const p = `[...document.querySelectorAll('.chapter[data-id="c1"] .chapter-body p')].find((p) => p.textContent.includes('tossed'))`;
  await clickOn(p, 1000);
  // the caret to the paragraph's end, then a new line
  await js(`(() => { const p = ${p}; const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p.closest('.chapter-body').focus(); })()`);
  key('End');
  await tick(300);
  key('Return');
  await tick(500);
  await js(`document.querySelector('.chapter[data-id="c1"] .chapter-body').dispatchEvent(new Event('input', { bubbles: true })); getSelection().anchorNode.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' })`);
  await tick(900);
  await type('Bramble tossed his mane and snorted.');
  await tick(500);
  await cap('You paused. Canon checked quietly — never mid-sentence.');
  await until(`canonSlips.some((s) => s.span === 'his')`, 30000).catch(() => {});
  await tick(1800);

  // 4. hover the mark; the popover; his -> her
  const at = await js(`(() => { const s = canonSlips.find((s) => s.span === 'his'); const r = s.range.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await moveTo(at.x + 140, at.y + 70, 700);
  await until2(() => moveTo(at.x, at.y, 600), `!!document.querySelector('.canon-pop')`);
  await cap('Hover the mark: where Canon knows it from.');
  await tick(3800);
  const main = await centre(`document.querySelector('.canon-pop .cp-main')`);
  await click(main.x, main.y, 800);
  await until(`!document.querySelector('.canon-pop')`);
  await cap('One click. One undo step.');
  await tick(2600);

  // 5. Go to Anything
  await cap('');
  await moveTo(900, 300, 500);
  await until2(() => key('K', [CMD]), `!!document.querySelector('.go-input') && document.activeElement === document.querySelector('.go-input')`);
  await tick(500);
  await type('grey mare', 110);
  await until(`go && go.shelf && go.shelf.length > 0`, 8000).catch(() => {});
  await tick(300);
  await cap('⌘K finds entries, facts and passages across the shelf.');
  await tick(3000);
  key('Return');
  await until(`!go && currentTab === 'canon' && canonShown === 'bramble'`);
  await js(`$('#nav-pane').classList.remove('open')`);
  await cap('Bramble again, with everything that links to her.');
  await tick(1200);
  await js(`(() => { const b = document.querySelector('#canon-view .cn-backs'); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); })()`);
  await tick(4200);

  // 6. World Map, 3D, slow turn
  await cap('');
  await until2(() => key('M', [CMD, 'shift']), `!!document.querySelector('#map-view') && NeoMap.nodes().length > 0`);
  await tick(900);
  await cap('The World Map: every entry, and who appears with whom.');
  await tick(1800);
  await clickOn(`document.querySelector('#map-view .map-modes button[data-mode="3d"]')`, 900);
  await tick(900);
  const from = { x: 160, y: 740 };
  await moveTo(from.x, from.y, 600);
  const z = await zoomOf();
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(from.x * z), y: Math.round(from.y * z), button: 'left', clickCount: 1 });
  for (let i = 1; i <= 60; i++) {
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round((from.x + i * 7) * z), y: Math.round((from.y - i * 0.8) * z), button: 'left', modifiers: ['leftButtonDown'] });
    await tick(60);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round((from.x + 420) * z), y: Math.round((from.y - 48) * z), button: 'left', clickCount: 1 });
  await tick(2200);

  // 7. end card
  await cap('');
  await js(`(() => {
    const c = document.createElement('div');
    c.id = 'demo-end';
    c.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:#14141a;color:#f3efe6;font:600 54px/1.2 Georgia,serif;letter-spacing:.01em;opacity:0;transition:opacity .9s';
    c.innerHTML = '<div style="text-align:center">NEO Canon<div style="font:400 30px/1.5 Georgia,serif;margin-top:14px;color:#e2c26b">You write. It remembers.</div></div>';
    document.body.appendChild(c);
    requestAnimationFrame(() => requestAnimationFrame(() => { c.style.opacity = '1'; }));
  })()`);
  await tick(4200);
}

/* ---------- encoding ---------- */

function encode() {
  fs.mkdirSync(OUT, { recursive: true });
  // a concat list with each frame's own duration (the window renders at no fixed rate)
  const lines = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const dur = next ? Math.max(0.02, (next.t - f.t) / 1000) : 0.5;
    lines.push(`file '${f.file}'`, `duration ${dur.toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = path.join(tmp, 'frames.txt');
  fs.writeFileSync(list, lines.join('\n'));
  const mp4 = path.join(OUT, 'neo-canon-demo.mp4');
  const gif = path.join(OUT, 'neo-canon-demo.gif');
  const run = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  run(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=15,scale=1440:900:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  const pal = path.join(tmp, 'palette.png');
  const fit = 'fps=10,scale=960:-1:flags=lanczos';
  run(['-i', mp4, '-vf', fit + ',palettegen=max_colors=128:stats_mode=diff', pal]);
  run(['-i', mp4, '-i', pal, '-lavfi', fit + '[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif]);
  console.log(`mp4 ${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB, gif ${(fs.statSync(gif).size / 1e6).toFixed(2)} MB, ${frames.length} frames`);
}

async function main() {
  await app.whenReady();
  let failed = false;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    if (process.env.DEMO_DEBUG) wc.on('console-message', (e) => console.log('renderer:', e.message, e.lineNumber));
    win.setSize(1440, 900);
    win.setPosition(0, 0);
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(500);
    win.focus();
    await prepare();
    recording = true;
    t0 = Date.now();
    const grabbing = grab();
    try { await story(); } finally { recording = false; await grabbing; }
    encode();
    if (process.env.DEMO_KEEP) console.log('frames kept in ' + FRAMES);
  } catch (err) {
    failed = true;
    console.error(err);
    try { fs.writeFileSync(path.join(tmp, 'fail.png'), (await wc.capturePage()).toPNG()); console.error('see ' + path.join(tmp, 'fail.png')); } catch { /* none */ }
  } finally {
    if (!failed && !process.env.DEMO_KEEP) fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
main();

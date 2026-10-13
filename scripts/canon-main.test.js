'use strict';

// Canon's files on disk: the canon:* handlers in main.js, loaded the way
// scripts/filesystem.test.js loads them (Electron replaced, the real disk).

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
const FIXTURE = path.join(__dirname, 'fixtures', 'canon', 'library');

function loadMain(dir, opts = {}) {
  const handlers = new Map();
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => dir, getLocale: () => 'en', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: opts.fork || (() => ({ on() {}, postMessage() {} })) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root, process: { platform: process.platform, on() {}, env: {} }, console, libraryRoot: dir
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
  vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
  // answers come from another realm: plain copies compare as values
  const call = (name, ...args) => {
    const out = handlers.get(name)(null, ...args);
    return out === undefined ? out : JSON.parse(JSON.stringify(out));
  };
  call.context = context;
  call.handler = (name) => handlers.get(name);
  return call;
}

function library() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-main-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe('canon files', { concurrency: 1 }, () => {
  test('Keep a Canon makes canon-<slug>-<shelf>/ with canon.json and entries/, and takes an old one up again', () => {
    const dir = library();
    try {
      const call = loadMain(dir);
      const id = call('canon:create', 'shelf-new', 'Drafts & Ideas');
      assert.equal(id, 'canon-drafts-ideas-shelf-new');
      const folder = path.join(dir, id);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'canon.json'), 'utf8')), { v: 1, shelfId: 'shelf-new', read: {}, out: {}, settings: {} });
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'not-slips.json'), 'utf8')), []);
      assert.ok(fs.statSync(path.join(folder, 'entries')).isDirectory());
      assert.ok(fs.statSync(path.join(folder, 'set-aside')).isDirectory());
      // the fixture's folder, renamed shelf or not, is the same Canon
      assert.equal(call('canon:create', 'shelf-ash', 'Renamed'), 'canon-the-ashfall-road-shelf-ash');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'canon-the-ashfall-road-shelf-ash', 'canon.json'), 'utf8')).out, { 'book-field-notes-notes3': ['p3'] });
      assert.throws(() => call('canon:create', '../x', 'X'), /Invalid library name/);
      assert.throws(() => call('canon:open', 'book-ember-and-thorn-ember1'), /Invalid canon name/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('entries are written only when they change, with conflicts handed back', () => {
    const dir = library();
    try {
      const call = loadMain(dir);
      const id = 'canon-the-ashfall-road-shelf-ash';
      const e = Canon.newEntry('Bramble', 'creature');
      e.facts.push(Canon.handFact('Sex: mare'));
      const saved = call('canon:saveEntry', id, e, null);
      assert.equal(saved.ok, true);
      const file = path.join(dir, id, 'entries', 'bramble.md');
      assert.equal(fs.readFileSync(file, 'utf8'), Canon.serialiseEntry(e));
      const mtime = fs.statSync(file).mtimeMs;
      assert.equal(call('canon:saveEntry', id, e, saved.stamp).ok, true);
      assert.equal(fs.statSync(file).mtimeMs, mtime); // unchanged: not written
      // edited in a text editor meanwhile: the window gets the disk version
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + 'Bites.\n');
      const clash = call('canon:saveEntry', id, e, saved.stamp);
      assert.equal(clash.conflict, true);
      assert.equal(clash.entry.words, 'Bites.\n');
      const open = call('canon:open', id);
      assert.equal(open.entries.length, 1);
      assert.equal(open.entries[0].data.name, 'Bramble');
      assert.deepEqual(open.notSlips.map((n) => n.fact), ['ilsa-varr/eyes']);
      assert.deepEqual(call('canon:refresh', id, { bramble: saved.stamp, gone: 'x' }).changed.map((x) => x.id), ['bramble']);
      assert.deepEqual(call('canon:refresh', id, { bramble: clash.stamp, gone: 'x' }), { changed: [], removed: ['gone'] });
      // an entry Canon can't read is listed, and left alone
      fs.writeFileSync(path.join(dir, id, 'entries', 'odd.md'), 'scribbles');
      assert.equal(call('canon:open', id).entries.find((x) => x.id === 'odd').error, 'unreadable');
      assert.equal(call('canon:open', id).entries.find((x) => x.id === 'odd').line, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Set Aside moves an entry\'s file and Restore brings it back; meta keeps only its own keys', () => {
    const dir = library();
    try {
      const call = loadMain(dir);
      const id = 'canon-the-ashfall-road-shelf-ash';
      call('canon:saveEntry', id, Canon.newEntry('Rook', 'creature'), null);
      assert.equal(call('canon:setAside', id, 'rook'), 'rook');
      assert.ok(fs.existsSync(path.join(dir, id, 'set-aside', 'rook.md')));
      assert.equal(call('canon:open', id).setAside[0].id, 'rook');
      assert.equal(call('canon:setAside', id, 'rook'), false);
      // a second Rook set aside beside the first takes the next free name
      call('canon:saveEntry', id, Canon.newEntry('Rook', 'creature'), null);
      assert.equal(call('canon:setAside', id, 'rook'), 'rook-2');
      assert.equal(call('canon:restore', id, 'rook'), 'rook');
      assert.ok(fs.existsSync(path.join(dir, id, 'entries', 'rook.md')));
      assert.equal(call('canon:restore', id, 'rook-2'), 'rook-2');
      assert.equal(call('canon:open', id).entries.find((x) => x.id === 'rook-2').data.id, 'rook-2'); // the file's name is its id
      assert.throws(() => call('canon:setAside', id, '../rook'), /Invalid library name/);
      call('canon:saveMeta', id, { out: {}, read: { x: 1 } });
      const meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'canon.json'), 'utf8'));
      assert.deepEqual(meta.out, {});
      assert.deepEqual(meta.read, {});
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // The reader's download (P0 #3): a local server that cuts the connection
  // halfway; the next try picks up the .part with a Range request
  test('the reader downloads, resumes a cut-off file, and throws away a damaged one', async () => {
    const http = require('node:http');
    const crypto = require('node:crypto');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-dl-'));
    const body = crypto.randomBytes(300000);
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const ranges = [];
    let cut = true;
    const server = http.createServer((req, res) => {
      const m = /bytes=(\d+)-/.exec(req.headers.range || '');
      const from = m ? +m[1] : 0;
      ranges.push(from);
      res.writeHead(m ? 206 : 200, { 'Content-Length': body.length - from });
      if (cut) { cut = false; res.write(body.subarray(from, 120000)); setTimeout(() => res.destroy(), 50); return; }
      res.end(body.subarray(from));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/reader.gguf`;
    try {
      const { downloadFile } = loadMain(dir).context;
      const dest = path.join(dir, 'models', 'reader.gguf');
      const seen = [];
      const get = (sha256) => downloadFile({ url, dest, size: body.length, sha256, fetchFn: fetch, onProgress: (got) => seen.push(got) });
      await assert.rejects(get(sha), (err) => err.code === 'offline');
      assert.equal(fs.statSync(dest + '.part').size, 120000);
      await get(sha);
      assert.deepEqual(ranges, [0, 120000]);
      assert.ok(fs.readFileSync(dest).equals(body));
      assert.ok(!fs.existsSync(dest + '.part'));
      assert.equal(seen[seen.length - 1], body.length);
      // the wrong checksum: thrown away, nothing left behind
      fs.rmSync(dest);
      await assert.rejects(get('0'.repeat(64)), (err) => err.code === 'damaged');
      assert.ok(!fs.existsSync(dest) && !fs.existsSync(dest + '.part'));
      // pressing Pause: an abort, the .part kept for later
      cut = false;
      const ctrl = new AbortController();
      const slow = (u, opts) => fetch(u, opts).then((res) => { ctrl.abort(); return res; });
      await assert.rejects(downloadFile({ url, dest, size: body.length, sha256: sha, fetchFn: slow, signal: ctrl.signal }), (err) => err.code === 'aborted');
      // and nobody there at all
      await assert.rejects(downloadFile({ url: 'http://127.0.0.1:9/x', dest, size: body.length, sha256: sha, fetchFn: fetch }), (err) => err.code === 'offline');
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Which reader suits this computer: the graphics card first, then memory
  test('the reader recommended from the hardware: an 8 GB GPU → thorough, 6 GB or Apple silicon with 16 GB → careful; the processor alone → quick', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-canon-pick-'));
    try {
      const call = loadMain(dir);
      const pick = (o) => vm.runInContext(`readerPick(${JSON.stringify(o)})`, call.context);
      // a graphics card with 8 GB of its own (the owner's RTX 3080 has 10) reads like an editor, thoroughly
      assert.equal(pick({ totalGB: 8, platform: 'win32', arch: 'x64', vramGB: 12 }), 'thorough');
      assert.equal(pick({ totalGB: 32, platform: 'win32', arch: 'x64', vramGB: 10 }), 'thorough');
      assert.equal(pick({ totalGB: 8, platform: 'linux', arch: 'x64', vramGB: 6 }), 'careful');
      assert.equal(pick({ totalGB: 8, platform: 'linux', arch: 'x64', vramGB: 4 }), 'quick');
      assert.equal(pick({ totalGB: 16, platform: 'darwin', arch: 'arm64' }), 'careful');
      assert.equal(pick({ totalGB: 24, platform: 'darwin', arch: 'arm64' }), 'thorough');
      assert.equal(pick({ totalGB: 8, platform: 'darwin', arch: 'arm64' }), 'quick');
      // on the processor alone a reader with a block over 2 GiB can't start inside NEO
      assert.equal(pick({ totalGB: 32, platform: 'linux', arch: 'x64' }), 'quick');
      assert.equal(pick({ totalGB: 64, platform: 'linux', arch: 'x64' }), 'quick');
      assert.equal(pick({ totalGB: 32, platform: 'darwin', arch: 'x64' }), 'quick');
      assert.equal(pick({ totalGB: 6, platform: 'linux', arch: 'x64' }), 'short');
      assert.equal(pick({ totalGB: 6, platform: 'linux', arch: 'x64', vramGB: 8 }), 'thorough');
      // and once a reader failed here, the next one down
      assert.equal(pick({ totalGB: 32, platform: 'darwin', arch: 'arm64', failed: 'careful' }), 'quick');
      assert.equal(pick({ totalGB: 32, platform: 'win32', arch: 'x64', vramGB: 10, failed: 'thorough' }), 'careful');
      // the deep reader is offered, never picked: a card with 12 GB
      const offered = (o) => JSON.parse(vm.runInContext(`JSON.stringify(readerOffered(${JSON.stringify(o)}))`, call.context));
      assert.deepEqual(offered({ totalGB: 32, platform: 'win32', arch: 'x64', vramGB: 10 }), ['thorough', 'careful', 'quick']);
      assert.deepEqual(offered({ totalGB: 32, platform: 'win32', arch: 'x64', vramGB: 16 }), ['thorough', 'deep', 'careful', 'quick']);
      assert.deepEqual(offered({ totalGB: 32, platform: 'linux', arch: 'x64' }), ['careful', 'quick']);
      // the catalogue: Thorough and Deep pinned, thinking off, the editor's reading
      const R = vm.runInContext('READERS', call.context);
      assert.equal(R.thorough.sha256, 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785');
      assert.equal(R.thorough.size, 5027783488);
      assert.match(R.thorough.url, /\/resolve\/7c41481f57cb95916b40956ab2f0b139b296d974\/Qwen3-8B-Q4_K_M\.gguf$/);
      assert.equal(R.deep.sha256, '500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0');
      assert.equal(R.thorough.thoughts, 'discourage');
      assert.equal(R.quick.editor, undefined);
      // Reader settings: the hardware and the reader chosen are kept in settings.json
      const r = call('canon:readerSettings', { hardware: 'cpu' });
      assert.equal(r.hardware, 'cpu');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).readerHardware, 'cpu');
      assert.equal(call('canon:readerSettings', { hardware: 'auto' }).hardware, 'auto');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).readerHardware, undefined);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // A reader on disk whose worker dies loading it (as the careful reader's
  // does inside Electron on a CPU): tried again on the processor, then
  // remembered; the pass runs without it and says so, Read the Shelf too
  test('a reader that can\'t start: retried on the processor, remembered, and the pass runs without it', async () => {
    const dir = library();
    try {
      const forks = [];
      const call = loadMain(dir, { fork: () => {
        const on = {};
        const child = { on: (ev, fn) => { on[ev] = fn; }, postMessage: (m) => { forks.push(m); setTimeout(() => on.exit && on.exit(5)); }, kill() {} };
        return child;
      } });
      const models = path.join(dir, 'models');
      fs.mkdirSync(models, { recursive: true });
      const careful = vm.runInContext('READERS.careful', call.context);
      fs.closeSync(fs.openSync(path.join(models, careful.file), 'w'));
      fs.truncateSync(path.join(models, careful.file), careful.size); // (sparse: no 2.5 GB written)
      assert.equal(call('canon:readerStatus').installed, 'careful');
      const canonId = 'canon-the-ashfall-road-shelf-ash';
      const lib = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
      const bookId = lib.shelves[0].bookIds[0];
      const res = await call.handler('canon:check')({ sender: { isDestroyed: () => true } }, { canonId, bookId, scope: 'book', html: {} });
      assert.equal(res.readerFailed, true);
      assert.ok(Array.isArray(res.slips));
      // Automatic, then the processor: two loads, the second with cpu
      assert.deepEqual(forks.filter((m) => m.type === 'load').map((m) => m.cpu), [false, true]);
      const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      assert.equal(settings.readerFailed.tier, 'careful');
      const status = call('canon:readerStatus');
      assert.equal(status.failed.tier, 'careful');
      // remembered: the next pass doesn't try again, Read the Shelf says why
      const n = forks.length;
      assert.equal((await call.handler('canon:check')({ sender: { isDestroyed: () => true } }, { canonId, bookId, scope: 'book', html: {} })).readerFailed, true);
      assert.equal((await call.handler('canon:readShelf')({ sender: { isDestroyed: () => true } }, canonId, {})).error, 'reader-failed');
      assert.equal(forks.length, n);
      // Try Again forgets it
      assert.equal(call('canon:readerSettings', { retry: true }).failed, null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

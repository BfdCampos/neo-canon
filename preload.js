const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('neo', {
  platform: process.platform,
  // macOS: the system dictionary panel for the selected word (#179)
  lookUpText: () => ipcRenderer.invoke('app:lookUp'),

  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),

  createBook: (meta) => ipcRenderer.invoke('book:create', meta),
  duplicateBook: (bookId, title) => ipcRenderer.invoke('book:duplicate', bookId, title),
  listBooks: () => ipcRenderer.invoke('library:listBooks'),
  readBookMeta: (bookId) => ipcRenderer.invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => ipcRenderer.invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => ipcRenderer.invoke('book:delete', bookId, title),

  readChapter: (bookId, chId) => ipcRenderer.invoke('chapter:read', bookId, chId),
  chapterStamps: (bookId) => ipcRenderer.invoke('chapter:stamps', bookId),
  writeChapter: (bookId, chId, html, expected) => ipcRenderer.invoke('chapter:write', bookId, chId, html, expected),
  deleteChapter: (bookId, chId) => ipcRenderer.invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => ipcRenderer.invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => ipcRenderer.invoke('aux:write', bookId, name, html),
  snapshotList: (bookId) => ipcRenderer.invoke('snapshot:list', bookId),
  snapshotRead: (bookId, name, file) => ipcRenderer.invoke('snapshot:read', bookId, name, file),
  snapshotWrite: (bookId, name, file, text) => ipcRenderer.invoke('snapshot:write', bookId, name, file, text),
  snapshotRemove: (bookId, name) => ipcRenderer.invoke('snapshot:remove', bookId, name),

  readJSON: (bookId, name, fallback) => ipcRenderer.invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => ipcRenderer.invoke('json:write', bookId, name, data),

  exportSave: (payload) => ipcRenderer.invoke('export:save', payload),
  emailDraft: (payload) => ipcRenderer.invoke('email:draft', payload),
  logError: (msg) => ipcRenderer.invoke('log:error', msg),
  importPick: () => ipcRenderer.invoke('import:pick'),
  libraryPath: () => ipcRenderer.invoke('library:path'),
  pickCover: () => ipcRenderer.invoke('cover:pick'),
  setCover: (bookId, srcPath) => ipcRenderer.invoke('cover:set', bookId, srcPath),
  removeCover: (bookId) => ipcRenderer.invoke('cover:remove', bookId),
  readCover: (bookId, fname) => ipcRenderer.invoke('cover:read', bookId, fname),
  paintCover: (bookId, text, options) => ipcRenderer.invoke('cover:paint', bookId, text, options),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  hasSecret: (name) => ipcRenderer.invoke('secret:has', name),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),
  fullscreenToggle: () => ipcRenderer.invoke('fullscreen:toggle'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  spellCheckWords: (words) => ipcRenderer.invoke('spell:check', words),
  spellSuggest: (word) => ipcRenderer.invoke('spell:suggest', word),
  spellLearn: (word) => ipcRenderer.invoke('spell:learn', word),
  setSpellLanguage: (code) => ipcRenderer.invoke('spell:setLanguage', code),
  appVersion: () => ipcRenderer.invoke('app:version'),
  openRelease: () => ipcRenderer.invoke('update:openRelease'),

  // Go to Anything: the menu's commands, and running one
  menuItems: () => ipcRenderer.invoke('menu:items'),
  menuRun: (where) => ipcRenderer.invoke('menu:run', where),
  // Canon (canon.js; the CANON block in main.js)
  canonCreate: (shelfId, shelfName) => ipcRenderer.invoke('canon:create', shelfId, shelfName),
  canonOpen: (canonId) => ipcRenderer.invoke('canon:open', canonId),
  canonRefresh: (canonId, stamps) => ipcRenderer.invoke('canon:refresh', canonId, stamps),
  canonSaveEntry: (canonId, entry, stamp) => ipcRenderer.invoke('canon:saveEntry', canonId, entry, stamp),
  canonSetAside: (canonId, entryId) => ipcRenderer.invoke('canon:setAside', canonId, entryId),
  canonRestore: (canonId, entryId) => ipcRenderer.invoke('canon:restore', canonId, entryId),
  canonSaveMeta: (canonId, patch) => ipcRenderer.invoke('canon:saveMeta', canonId, patch),
  canonReaderStatus: () => ipcRenderer.invoke('canon:readerStatus'),
  canonCheck: (opts) => ipcRenderer.invoke('canon:check', opts),
  canonStop: () => ipcRenderer.invoke('canon:stop'),
  canonReadShelf: (canonId, opts) => ipcRenderer.invoke('canon:readShelf', canonId, opts),
  canonPassages: (opts) => ipcRenderer.invoke('canon:passages', opts),
  canonIndex: (canonId) => ipcRenderer.invoke('canon:index', canonId),
  canonMentions: (canonId, entryId, opts) => ipcRenderer.invoke('canon:mentions', canonId, entryId, opts),
  canonSearch: (canonId, q, seq) => ipcRenderer.invoke('canon:search', canonId, q, seq),
  canonNotSlip: (canonId, record) => ipcRenderer.invoke('canon:notSlip', canonId, record),
  canonUnNotSlip: (canonId, record) => ipcRenderer.invoke('canon:unNotSlip', canonId, record),
  canonDownload: (tier) => ipcRenderer.invoke('canon:download', tier),
  canonPauseDownload: () => ipcRenderer.invoke('canon:pauseDownload'),
  canonTyping: () => ipcRenderer.send('canon:typing'),
  canonQuietState: (on) => ipcRenderer.send('canon:quietState', on),
  onCanon: (cb) => ipcRenderer.on('canon', (_e, msg) => cb(msg)),

  poetryState: (on) => ipcRenderer.send('poetry:state', on),
  flushState: (on) => ipcRenderer.send('flush:state', on),
  scriptState: (st) => ipcRenderer.send('script:state', st),
  printPaperback: (job) => ipcRenderer.invoke('print:paperback', job),
  // sent (and waited for) as a script line is right-clicked, so the menu
  // that opens next can offer Page Break Here
  scriptContext: (st) => ipcRenderer.sendSync('script:context', st),
  typewriterState: (st) => ipcRenderer.send('typewriter:state', st),
  vimState: (on) => ipcRenderer.send('vim:state', on),
  uiZoomState: (z) => ipcRenderer.send('uizoom:state', z),
  // interface language, fetched once before the page's scripts run
  i18n: ipcRenderer.sendSync('i18n:get'),
  paper: ipcRenderer.sendSync('paper:get'), // 'Letter' or 'A4', from the computer's region
  reloadForLanguage: () => ipcRenderer.invoke('i18n:reload'),

  writingStyleState: (st) => ipcRenderer.send('style:state', st),
  viewState: (st) => ipcRenderer.send('view:state', st),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});

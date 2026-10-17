# NEO Canon — notes for agents

NEO Canon is a fork of NEO (by Hugh Howey) that adds Canon, a continuity engine. NEO is a local word processor for books. It is an Electron app made of plain JavaScript, HTML, and CSS. There is no bundler, no framework, and no compile step. `npm start` runs `electron .`.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding a feature. The product is opinionated on purpose. A change that helps someone finish a book belongs here. A change that adds a panel, a prompt, or a dependency usually does not.

## Rules that override convenience

- Nothing interrupts a writer mid-sentence. No popups, no squiggles, no notifications while typing. Spellcheck is off until the writer asks for a pass.
- Controls stay hidden until hover or keyboard focus. Two deliberate exceptions, the owner's choice after a user test: **← Back to Shelf** sits at the editor's top left in plain sight (subtle, not hover-hidden; beside the traffic lights on macOS, where the book's title moves over), the one way back besides Esc; and the Canon tab opens with both panes pinned (below).
- Words are never discarded. Deleting text, unbinding a shelf, or losing a trash operation must leave the words recoverable (Darlings, a sibling chapter, or the system trash). `book:delete` uses `shell.trashItem`. If trash fails, leave the folder and show it.
- Books are plain files. No database, no proprietary format.
- The renderer never touches the filesystem. Disk access goes through `window.neo` (`preload.js`) to handlers in `main.js`.
- Do not save UI decoration into chapter HTML. Search highlights, spellcheck underlines, and focus dimming use the CSS Highlight API so they stay out of the file.
- Do not rewrite a chapter that has not changed. Libraries are synced with iCloud and Syncthing. A timer that writes every chapter on an interval will fight the other device.

## Where the code is

| File | Role |
|---|---|
| `main.js` | Window, menus, every filesystem operation, import parsing, PDF, backups |
| `preload.js` | The entire renderer API, `window.neo` |
| `index.html` | Two views: `#bookshelf-view` and `#editor-view`. CSP is `script-src 'self'` |
| `app.js` | The whole UI, in banner-marked sections. Search for the banner before reading the file |
| `styles.css` | All styling. Tokens are CSS variables at the top |
| `covers.js` | Shelf covers in the window: seeded canvas art plus real title type. `window.NeoCovers` |
| `art.js` | Painted covers in the main process. OpenAI only. Title and author are never sent to the image model |
| `i18n.js` | `t()` / `tk()`, shared by main and the window. English source text is the key |
| `spell-worker.js` | Hunspell WASM, forked with `utilityProcess`. Messages: `load`, `check`, `suggest`, `add` |
| `spell-ro.js` | Romanian diacritics, used by the worker. Does not alter the manuscript |
| `locales/<code>.json` | One language. Regional files (`fr-CA.json`) hold only the strings that differ |
| `pocket/` | Capacitor shell. It does not contain its own editor |
| `print/` | Vendored Paged.js and hyphenation patterns for paperback PDFs |

`app.js` section banners look like `/*  SAVING  */`. Start there: bookshelf, bound shelves, editor open, typing, poetry, screenplays, placeholders, nav, tabs, outline, outline cards, darlings, counters, saving, refresh, structural undo, find, import, spellcheck, focus, goals, export.

Menus are built in `buildMenu()` in `main.js`. A menu click sends `{ type, ... }` to the window; `app.js` handles it on `window.neo.onMenu`.

## Canon

A shelf can keep a Canon: its people, places, creatures and rules, each fact citing the passage it came from. Specs are in `docs/semantics/` (PRODUCT, ARCHITECTURE, IDE, ACCURACY, STORY, and READING for the editor-workflow rebuild). The principle: the local reader proposes, code decides. Never generate prose. A fact whose quote is not found in the text is unverified and never raises a slip.

| File | Role |
|---|---|
| `canon.js` | Pure logic: entries, facts, merging, quote checks, slip detection, substitutions. No I/O |
| `canon-worker.js` | The local reader, forked with `utilityProcess` like the spell worker. The model runs here |
| `canon-editor.js` | The editor's reading (READING.md): cast gate, passage packs, fact gates, open-fact slip candidates, profile gate. Pure, loaded by `canon.js` in Node only |
| `map.js` | World Map, 2D and 3D |
| `app.js` | CANON and GO TO ANYTHING sections (⌘K). Search for the banner. Pocket has neither `canon.js` nor the `canon*` bridge, so Canon stays asleep there |
| `main.js` | `canon:*` IPC (create, open, refresh, saveEntry, check, readShelf, download, readerStatus, search, notSlip…), reader download, files |

- On disk, beside the books: `canon-<slug>-<shelfId>/` holding `canon.json`, `not-slips.json`, `entries/*.md` (one plain Markdown file per entry) and `set-aside/*.md` (entries set aside, restorable). NEO ignores these folders. The folder name still passes through `libName()`. Writes are durable, like every library write.
- Outside the library, in Electron `userData`: `models/` (the downloaded reader) and `canon-cache/<canonId>/index.json`, this device's cache of the reader's proposals and answers per paragraph, so an unchanged paragraph isn't asked again. It is never in the library; deleting it costs only a slower next reading.
- The Canon tab shows on every book. On a shelf without a Canon it is an offer (`canonInvite`: Keep a Canon for “{shelf}”, and Open the Tutorial). On a shelf that keeps one, both panes open pinned (entries left, Needs You and the map right) until the writer unpins one there: `panePins`, kept per device in `localStorage` `neo-pinned-panes` as `canonNav`/`canonSide`, apart from the Manuscript's own `nav`/`side` (which stay hover-hidden by default). Needs You shows without a reader too.
- The reader is always findable (`canonRdr`, READER section in CANON): a line at the top of every Canon page (`canonReaderLine`: No reader yet — Download (n GB) / Downloading… n% · Pause / Reader ready · {device}, and Reader settings), Help → Canon Reader… (`showCanonReader`, also found by ⌘K), and in a pass's pane, when it checked less for want of one, `canonPassReader` (Some checks need the reader. Download it…). A page link `<a href="neo:reader">` (the Tutorial's) starts the download and shows that window; `captureBody` keeps it.
- Hardware: `canon-worker.js` asks node-llama-cpp for `gpu: 'auto'` (Metal on Apple silicon, CUDA or Vulkan elsewhere, else the CPU) and `gpuLayers: 'auto'`; a GPU that won't start or a model that won't fit falls back to the CPU and main logs it. A load takes `ctx` (8,192 for the editor's reading), `sequences` (parallel prompts on a GPU, 1 on the CPU) and `thoughts: 'discourage'` (Qwen3 hybrids); a prompt may ask for `compact` one-line JSON. `probe` reports the backend, device names and VRAM, kept in `settings.json` `readerDevice`. Readers (`READERS` in `main.js`, sha-pinned): thorough (Qwen3-8B), deep (Qwen3-14B, offered at 12 GB, never picked), careful (Qwen3-4B), quick (Qwen2.5-1.5B). `readerPick`: a GPU with 8 GB or Apple silicon with 24 GB → thorough; 6 GB or Apple silicon with 16 GB → careful; the processor alone → quick (8 GB and up), because in Electron's processes Chromium's allocator refuses one block over 2 GiB (the worker dies, exit 5; plain Node loads it); a reader that failed here steps down. `readerOffered` hides what can't run. A reader that can't start (`canonLoadModel`: Automatic tried, then the CPU once) is kept as `readerFailed` in `settings.json`: passes and quiet checks run without it, Read the Shelf says so with Try Again and Reader settings. Packaging leaves out the CUDA prebuilts; NVIDIA cards run through Vulkan.
- The editor's reading (READING.md; readers with `editor: true`, careful and up; quick keeps the per-paragraph `propose`): per chapter, `cast` (code keeps names as written, roles written twice, aliases the text ties, the setting) → passage packs (code) → `dossier` (open facts citing sentence numbers; code copies the clause as the quote) → gates (cited, grounded, polarity, speech → said, not from a slip's sentence: `editorSuspects`) → `verify` (yes only; twice for what is read between the lines) → merge and section order → `profile` (every content word in its facts; `## Profile` with `[n]` sources, Canon's mark `note:`; edited, it is the writer's). Open facts are `attr: 'other'` with a label (`openLabel` never collides with a trait or relation); hard traits still need the rules, a pronoun's trait only where nothing else gives a value (the reader's referent answer kept in `canon.json` `refs`). The device cache holds `ed` (cast, dossier, verdict, profile, dropped); `canon.json` `edited` marks chapters read this way. Open-fact slips: `clashCandidate` (code) then `clash` asked both ways; Needs You never holds open said facts.
- Welcome and Tutorial (WELCOME AND THE TUTORIAL in `app.js`): the welcome sheet shows once per computer on the shelf at launch (`settings.json` `canonWelcome`, `welcome:seen`). `tutorial:open` in `main.js` copies `tutorial/` (a story, the Start Here notebook, a pre-built Canon) under new ids, filling `@LESSONS@`/`@STORY@`/`@SHELF@` and writing ⌘ keys as Ctrl+ off macOS; the window adds the shelf (`shelf.tutorial` holds its two book ids). Opened again, the same shelf; afresh, the old one's books leave the shelves whole. `scripts/tutorial.test.js` holds the story to its three seeded slips and the lessons to the story's pace: Chapter 1 with lesson 2, Chapter 2 before lesson 4, Chapter 3 before lesson 5 (the pass), so no lesson uses a chapter not yet read. Lesson 3 (Get the Reader) and lesson 10 carry the `neo:reader` button; the reader arriving never starts Read the Shelf on the Tutorial's shelf (`canonAutoRead`), so lessons 4–9 find its world as written; every other Try this works without a reader, and the e2e's `tutorial` part walks them. Quiet checks run without a reader too, on the facts kept by hand.
- First said, first kept (`firstCome` in `canon.js`, ACCURACY.md): a proposal that gets through the gates (verbatim quote, value word in it, entity tied by rule or by the reader's double answer) is checked without asking; the first value in reading order wins, the writer's Notes and notebook pages before the books. A later value that differs is left out of the entry: it is the pass's slip. What fails a gate is left out quietly (`dropped` in the cache says why), never asked. Needs You holds only the writer's notes against the prose (*Which is right?*, every value with its passage) and what is only said or planned. A sex no word gives comes from the narration's own she/her or he/him: two sentences or more tied by the slip checker's rules, none against, never speech (`pronounEvidence`).
- Needs You answers once. *It's true* makes the said or planned fact the writer's, keeping its passage (merged into a fact of the same value if there is one); *Only what's said* sets it aside with it; a read never asks either again (`accept`). *Skip* is kept in `canon.json` `skipped`. A said line whose value the facts already hold is not asked and not listed under What others say (`canonSettled`). The buttons wait while the answer is saved.
- One fact per value: `parseEntry` and `serialiseEntry` merge facts of the same attribute and value (`dedupFacts`), every source kept; `canon:open` rewrites only a file that held copies (`canonHeal`). Speech is read by which side each quotation mark faces (`speechSpans`); a mark left open mid-paragraph makes nothing speech, and a short quoted term ("Fleets.") is not dialogue.
- Story so far (STORY.md): with a reader, each changed story paragraph is asked for 0–2 key points (`events`); `gateEvent` keeps only a verbatim quote outside speech, each who named in it or meant by its pronoun (`referent`), and no word the writer didn't write. They live in each entry's `.md` under `## Story so far` as `· Canon’s note` lines whose source carries `note:<hash>`; a line whose words no longer match the hash, or has no marker, is the writer's and is never rewritten. A chapter read again has its notes made afresh (`canon.json` `story` marks the chapters done). In a pass, `deedSlips` asks the reader whether a later sentence gives an earlier key point's deed to someone else (`contradicts`): yes is a slip on the name with the plain name swap as its fix, unclear or the Quick reader is Worth a look, no reader is nothing. Events are an index, never manuscript text.
- Reading pauses while the writer types and resumes after 10 s without a key (`CANON_RESUME_MS`); the quiet check runs after a 90 s pause in typing, or on ⌘' (Ctrl+'). A quiet check also runs while a pass's marks are up (not while the pass is still checking), adding what's new.
- Test and demo hooks, ignored when packaged: `NEO_CANON_FAKE` (a JSON of fake reader answers) and `NEO_CANON_FAKE_MS` (its delay), `NEO_CANON_READERS` (another reader catalogue; a missing file falls back to the real one), `NEO_CANON_QUIET_MS` (the 90 s quiet check) and `NEO_CANON_RESUME_MS` (the 10 s resume).
- Deleting or setting aside an entry must stay recoverable (`canon:setAside`, `canon:restore`). A change to a fact across the series takes a snapshot first and shows a review list.
- Checks run on a pause, never mid-sentence, and write nothing into chapter HTML: marks use the CSS Highlight API.
- The reader's model is downloaded on request, one button, then offline. Nothing about a manuscript leaves the machine.
- Tests: `scripts/canon*.test.js` (`npm test`; `canon-eval.js` is the model evaluation, not a test) and the end-to-end run `xvfb-run -a npx electron --no-sandbox scripts/canon.e2e.js` (`npm run test:canon` with a display). Screens for the docs are in `docs/semantics/screens/`.
- The folder stays `NEO Library` so a library opens in both apps. The rename is logged in `docs/semantics/RENAME.md`.

## Outline cards

The Outline tab shows the book as index cards (OUTLINE CARDS in `app.js`) unless `library.outlineView` is `'list'`. A script's Outline is always cards, one per scene (`scriptScenes`): heading, length in eighths, cast, and a note in `book.sceneNotes`, keyed by `data-scene-id` on the heading line. Dragging a scene card calls `spMoveScene`.

- Cards come from the manuscript, not a separate structure: each chapter is cut at its `p.scene-break` lines (`chapterSegments`). A section that holds a `p[data-sec-id]` belongs to that note in `book.sectionNotes`; the first section to carry an id owns it, because paragraphs split from a written ghost inherit the id. Others show their first line.
- Moving a card moves its paragraphs and *** between chapter bodies, then `syncChapter` and `orderSectionNotes`. Every move takes a `snapshotStructure` first.
- `syncGhosts` leaves a ghost where it stands and places a note the page lacks before the next section that's there. It never reorders ghosts.
- Loose cards are `book.looseCards`, shown in the right-hand pane while the Outline is up. A section card dragged there (or Move to loose cards) goes both ways: a section with writing takes its words along as `card.html`, out of the manuscript and the counts until it's placed again. Chapter cards and a script's scene cards go there too: the card carries the chapter (words, title, notes, kind; `held: 'chapter'`) or the scene's lines (`held: 'scene'`), written to book.json before they leave the page, and comes back whole (a chapter only between chapters). A card's Delete sends held words to Darlings first. A section card's Delete section sends its writing to Darlings (`deleteSectionToDarlings`).
- Several cards at once: ⌘-click (Ctrl-click) toggles a card, Shift-click takes a run, and a drag across empty outline space sweeps (`cardLasso`). The picked cards are `cardSel` (keys from `cardKey`), kept across a redraw and dropped after a move. Delete/Backspace or the right-click menu runs `deleteSelectedCards`: one `snapshotStructure`, the single deletes run quiet, sections and scenes from the last up, and a book keeps at least one chapter.
- `joinChapter` makes a chapter a section of another (List Tab on a chapter line, or a chapter card dropped on the middle of another). It moves the lines, persists the receiving chapter, and only then deletes the emptied one.
- In the List, Enter always makes a chapter and Tab always makes a section.
- On a card made new (`cardEditor.fresh`), Enter with words on it opens the next new card; Enter on an empty one, or Esc, stops. A pasted list (`pastedOutline`: the clipboard's HTML levels from `<ul>`/`<ol>` or Word's `mso-list`, else `outlineLines` on the text) becomes one card per item, and in the List one line per item: on a chapter, top items are chapters and deeper ones their sections. `scripts/outline-paste.test.js` covers the text's markers.
- While writing, the top of the right-hand pane shows the cards for where the caret is (`sideCardsUpdate`, `#side-cards`): the chapter's and its sections' (the caret's marked red), or the script scene's. Typed on there, they're the same notes; a scene gets its id with its first note.
- A script scene's card note shows in gray on the scene's empty first line (`spSceneNoteGhosts`, a `data-scene-note` screen mark that `captureBody` strips).

Brighter Interface is two settings: `library.uiBright` while writing (and on the shelf), `library.uiBrightAside` on the other tabs, bright unless turned off. `applyBright` picks one on every tab switch.
- The walking note (`walkNoteUpdate`) is an overlay inside `.chapter`, plus a `data-walk` mark on the caret's paragraph that `captureBody` strips. `note.dismissed` hides it for good.

## Screenplays

A book whose `book.json` says `"format": "screenplay"` is a script. Right-click (long-press) a shelf's + for New Script. The SCREENPLAYS section of `app.js` holds the feature; `scripts/screenplay.test.js` tests its rules.

- The whole script is one chapter, so selection and the arrow keys run through every scene. Scenes are found by their headings.
- Each line is a `<p>` whose class is its element: `sp-heading`, `sp-character`, `sp-paren`, `sp-dialogue`, `sp-transition`, `sp-shot`. Action has no class.
- Page breaks, page numbers, (CONT'D) and the gray suggestions come from `data-pg`, `data-fill`, `data-contd` and `data-ghost` marks. `captureBody` strips them. Never save them.
- Lengths in `styles.css` are in em of the script's type (51em = 8.5in, 1em = one 12pt line), so a line wraps the same on screen, in the off-screen measuring room and in the PDF. `spPaginate` places the pages from the line counts.
- `data-newpage` on a line is the writer's own page break (right-click → Page Break Here; Backspace at the line's start removes it). Unlike the screen marks it is saved, and it travels as `===` in Fountain and `StartsNewPage="Yes"` in Final Draft.
- A script's style lives in its `book.json`: `underlineHeadings: true` (Format → Underline Scene Headings) and `contd: false` ((CONT'D) turned off).
- A script exports as a PDF (letter, printed with `print: 'screenplay'`), Fountain or Final Draft (`.fdx`). The book formats don't apply.
- A `.fountain` or `.fdx` file dropped on a shelf or picked with Import becomes a new script. `importFile` in `main.js` only reads the file; `spFromFountain` and `spFromFdx` in `app.js` sort it into elements. Both readers are plain string functions, so the tests cover them (`scripts/fixtures/` holds a Final Draft file written by screenplain, an outside tool).

## Paperbacks for KDP

Export → Paperback for KDP… (also on the shelf's right-click Export) writes a print interior PDF and a cover template PDF beside it. `printPaperback` and `buildPrintHtml` are the PRINT BOOK section of `app.js`; `makePaperback`, `renderPaged` and `kdpCoverHtml` are in `main.js`, behind `print:paperback`.

- Trims are KDP's four most-used: 5×8, 5.25×8, 5.5×8.5, 6×9 (`PRINT_TRIMS` in `app.js`, `KDP_TRIMS` in `main.js`). Paper thickness, page limits and the inside-margin bands (`kdpGutterMin`) come from KDP's help pages; NEO adds a quarter inch to the minimum. If the page count crosses a band, the book is laid out again with the wider margin.
- Pages are set by Paged.js (`print/paged.polyfill.js`, vendored, MIT) in one offscreen window per export. A hidden window stalls its animation frames; a second offscreen window opened right after one closes fails. The window closes when the export ends. One patch in it is marked `NEO:` (a word hyphenated across a page turn broke a letter late).
- Hyphenation is soft hyphens put in by `hyphenateHtml` in `main.js` with TeX patterns (`print/hyphen/`, ISC), because Chromium only hyphenates on macOS. Only `p.hy` prose is touched; names (capitalised words, except in German) and a paragraph's last word stay whole.
- Chromium rounds page sizes to 0.01 in; `exactPageBox` rewrites the MediaBox to the exact size in the same number of bytes.
- The page count is kept even. Chapters open on a right-hand page; blank pages carry no head or number.
- Choices are kept: trim, paper, ISBN and fiction notice in `book.print`; on the pen name, `author.print` holds the back-matter links, `alsoByText` (the writer's own list, one title per line) and `reviewText` (own wording, with `{title}` for the book's title; empty means NEO's translated wording). A dedication typed in the dialog becomes the book's own Dedication page.
- Page 1 is the story's first page (the first `chapter` section, so a prologue). In the paperback that section is `.pg1` and each page's number is set on it after layout. The regular PDF stops counting on `@page front` pages and numbers its contents from the `data-p1` link; pages after page 1 that show no number (a part's title) are `.page.counted`.
- `scripts/print.test.js` covers the margin bands, hyphenation, the page box and the cover's size. Pocket has no paperback export.

## Snapshots

⌘S (Ctrl+S; File → Take Snapshot) snapshots the whole book (SNAPSHOTS in `app.js`). NEO also takes one before the first change of each writing day (`maybeDailySnapshot`, from `scheduleChapterSave` and `snapshotStructure`, built from `savedHTML` so it holds the day's start). No timer, and nothing is taken when nothing changed.

- One folder per snapshot, `book-…/snapshots/<UTC stamp>Z-<kind>-<chapters changed>-<words>-<rand>/`, holding only the chapters that changed since the last snapshot and, written last, `snapshot.json` (order, titles, kinds, a `textHash` of every chapter). Files are written once (`snapshot:list/read/write/remove` in `main.js`, the same four in Pocket's bridge). A chapter's text at a snapshot is in the newest snapshot at or before it holding the file (`snapHolder`).
- Kinds: `k` ⌘S, kept until deleted; `d` start of a day and `r` just before a restore, which go after 30 days (`snapsToThin`). A snapshot that goes first copies its chapter files into the next one that lacks them, so later snapshots still read whole.
- The Darlings tab's right-hand pane lists them (and stays open there); picking one shows the book as it was in `#snap-view`, read-only, words gone since marked with the CSS Highlight API (`wordsGone`). Restore This Chapter and Restore Whole Book take an `r` snapshot and a `snapshotStructure` first, so ⌘Z undoes them. A passage can be set aside as a darling from the right-click menu. Pocket takes snapshots but has no list yet.
- The daily backup zip leaves `snapshots/` out. `scripts/snapshots.test.js` covers the names, the fingerprint, thinning, where a chapter's text is and the marks.

## Per device

How NEO looks belongs to each device: `DEVICE_LOOK` in `app.js` (page theme, brightness, zoom, type size, typewriter, focus, counters, outline view, vim keys). Every library write also keeps them in this device's `localStorage`; every library read takes them back from there (`applyDeviceLook`). The library's copy is the last device's, which is what a device new to the library starts with. Zoom is per device and per view: the page per mode, the cards, and the shelf (`neo.shelfZoom`, ⌘+/− and pinch on the shelf), each in `localStorage`; the page moves in tenths. The desktop also keeps its page theme in `settings.json` for the window's color at launch, and `exportFolder` there, so save dialogs open where the last export went.

A book's right-click on the shelf is a small menu (`popMenu`) on the desktop, with the cover's choices one level in; touch keeps the larger cards. Duplicate (`book:duplicate`, and `duplicateBook` in Pocket's bridge) copies the folder under a new id and title.

Pocket makes PDFs through `NeoPdf`, a native plugin in each project: Android opens its print screen (Save as PDF), iOS draws the pages into a file for the share sheet. A script's title can be set bold, underlined or italic as a whole (`book.titleStyle`, ⌘B ⌘U ⌘I on the title page), and keeps it in the PDF, Fountain and Final Draft.

## Processes

```
index.html + app.js  →  preload.js (window.neo)  →  main.js  →  NEO Library
                                                      ↓
                                               spell-worker.js
```

The window is created with `contextIsolation: true` and `nodeIntegration: false`. New renderer capabilities are added in three places: an `ipcMain.handle` in `main.js`, a method on `window.neo` in `preload.js`, and the call site in `app.js`.

## Files on disk

Default library: `~/Documents/NEO Library` (`app.getPath('documents')`). **File → Library Folder…** stores another path in `userData/settings.json` and restarts. NEO does not move existing books.

```
NEO Library/
  library.json          shelves, author, pen names, customWords, spellLanguage
  _catalog.txt          regenerated map of folder → title; edits are ignored
  neo-errors.log
  Backups/neo-backup-YYYY-MM-DD.zip    one per day, 14 kept
  Exports/              emailed PDF snapshots
  book-<slug>-<id>/
    book.json           metadata and chapterOrder
    chapters/<id>.html
    notes.html
    outline.html
    darlings.json
    stickies.json
    cover-<ts>.<ext>    writer-chosen image
    art-<ts>.<ext>      painted image, plus art.json
```

App settings and the cover-art API key live in Electron `userData` (`settings.json`, `secrets.json`), not in the library. The key is encrypted with `safeStorage` when the OS allows it. Do not write secrets into the library.

Every book id, chapter id, and sidecar name passes through `libName()` in `main.js`. It allows one path segment and rejects `.`, `..`, slashes, and null bytes. Keep new files inside that helper.

Every library write goes through `writeFileDurable`: `file.tmp`, fsync, then rename into place, so a power cut can't leave an empty file. `writeJSON` also keeps the last version that read whole as `file.bak`, and `readJSON` falls back on `.tmp`, then `.bak`. A `book.json` lost with no copy is rebuilt from the chapter files (`rebuildBookMeta`). There is no append and no partial chapter update.

`json:write` and `aux:write` will create any single-segment `<name>.json` or `<name>.html` in the book folder. Prefer the existing names unless a new sidecar is actually required.

## Saving and sync

The window holds the open book in memory (`chapterHTML`, `book`, `stickies`, `darlings`) and remembers what it last wrote (`savedHTML`, `savedMetaSig`).

- Chapter and notes edits debounce 800 ms, then write only if the HTML changed and the chapter is still in `chapterOrder`.
- `flushAllSaves` runs every 20 s and on blur, hide, and close. It also stores `lastPosition` in `book.json`. A scroll-only change is not a new position.
- `refreshFromDisk` runs on focus, on visibility, and every 30 s while visible. It compares `mtimeMs:size` stamps and re-reads only changed chapters.
- Unchanged local chapter plus a changed file: adopt the file. If the file only has fewer words, adopt it and keep the displaced text in Darlings.
- Both sides changed: keep the local text on the page and insert the disk text as the next chapter, titled as from the other device.
- Skip a chapter whose write is still in flight. Drop a read that overlapped a local save. An empty read must not wipe a chapter that already has text.
- The same generation check applies to `library.json` on the shelf (`libraryGeneration`, `libraryWritesPending`).

Do not replace this with last-write-wins. The comments in `persistChapter` and `refreshFromDisk` explain cases that look redundant and are not.

## Interface language

Wrap writer-visible strings in `t('English text', { placeholder })`. Use `tk()` for strings translated later, at the point of display. In `index.html`, use `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, or `data-i18n-ph`.

After adding or changing strings:

```
node scripts/i18n.js template
node scripts/i18n.js check fr
```

`scripts/i18n.js` only scans `app.js`, `main.js`, `covers.js`, `index.html`, and Pocket's own `pocket/www/index.html` and `pocket/www/pocket-bridge.js`. A new string in another file will not enter the template until that list includes it. Pocket's page marks its words with the same `data-i18n*` attributes as the desktop's, and its ⋯ sheet and bridge use `t()`.

Details, plural forms, and regional fallback (`fr-CA` → `fr` → English) are in [TRANSLATING.md](TRANSLATING.md). Quotation marks follow the spellcheck language (`QUOTE_STYLES` in `app.js`). Import chapter detection is `CHAPTER_WORDS` in `main.js`. Cover small-words are `CONNECTORS` in `covers.js`.

Italian has no spellcheck dictionary: the only Hunspell package on npm is GPL-3.0-only, and NEO is MIT. Do not add it.

## Pocket

`pocket/` is a Capacitor app that runs the desktop editor. Its bridge (`pocket/www/pocket-bridge.js`) implements `window.neo` against the phone's library folder. Android shares `Documents/NEO Library` via sync. iOS uses the app folder, optionally iCloud, with `LibraryHome.swift` locating that folder.

`scripts/pocket-www.js` (run by CI, and by hand before a local build) copies `app.js`, `covers.js`, `styles.css`, `i18n.js`, `fonts/`, `locales/`, Hunspell's browser build, and the `SPELL_LANGUAGES` dictionaries from `main.js` into `pocket/www/`. Pocket's checker is `pocket/www/pocket-spell.js`, a module worker with the same messages as `spell-worker.js`. A change to those files changes Pocket. Pocket-only behavior belongs in `pocket-bridge.js` or the native projects, not behind a desktop-only branch scattered through `app.js`.

## Commands

```
npm install
npm start
npm test                   # node --test scripts/*.test.js
npm run test:coverage      # node --test --experimental-test-coverage scripts/*.test.js
npm run lint               # oxlint, Electron's standard-style JavaScript rules
npm run test:spellcheck    # node --test scripts/spellcheck.test.js
npm run test:dashes        # node --test scripts/dashes.test.js
npm run bundle             # Hugh: brings in the newest .bundle from ~/Downloads and pushes main
npm run release            # Hugh: next version (x.y.9 → x.(y+1).0), commit, push, tag (npm run release -- 2.0.0 for another)
npm run package:mac        # macOS build; npm run package calls this
npm run package:linux      # AppImage via electron-builder; also package, package:mac, package:win, package:all
```

Tests use `node:test` and load `app.js` or `spell-worker.js` inside `vm`. They are not run by CI. The only CI check is a Windows smoke test that the packaged exe boots and creates a library (`.github/workflows/build.yml`, on `v*` tags). Pocket builds from `.github/workflows/pocket.yml`.

`node scripts/check-romanian-package.js <Resources dir>` compares a packaged app's dictionaries to the source tree. `node scripts/benchmark-spellcheck.js` times the checker. Neither is an npm script.

## Handing changes to Hugh

Hugh pushes and releases himself and isn't a git user. Hand him work as a git bundle of main..your-branch, built on the latest origin/main, then tell him: save it to Downloads, `npm run bundle`. To ship a desktop release: `npm run release`. Both commands check their footing and stop with a plain sentence instead of half-finishing. Don't give him raw git or npm version steps when these cover it.

## When you change something

- A new filesystem operation needs a handler, a `libName()` boundary, and a `preload.js` method. Match the existing IPC names (`library:`, `book:`, `chapter:`, `aux:`, `json:`, `cover:`).
- A new writer-visible string needs `t()` and a template refresh.
- A new way to remove text needs a recovery path and a sentence in the UI that says where the words went.
- Export formats are assembled in `app.js` and written by `export:save` in `main.js`. EPUB is a zip built in memory. PDF is printed from temporary HTML.
- Errors in the main process are appended to `neo-errors.log` via `logError`. Renderer failures go through `window.neo.logError`. Do not swallow a save failure; `persistChapter` rolls `savedHTML` back so the next flush retries.

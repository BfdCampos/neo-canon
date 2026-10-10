# Canon as a writer's IDE

Scope added by the owner: "an IDE, but for writers". A code editor knows where each function is defined and used; Canon knows where each character, place and rule of the world is established and mentioned. This document adds four surfaces to the MVP and builds on [ARCHITECTURE.md](ARCHITECTURE.md) (milestones M0–M11). The engineer picks these up as **M12–M15**, after M11.

NEO's rules hold throughout. Nothing appears while typing, controls stay hidden until hover or focus, nothing is written into chapter HTML, and no file is written unless the writer changed something. All copy goes through `t()`.

---

## 1. Entry kinds

`canon.js` has `KINDS = ['person', 'creature', 'place', 'thing', 'group', 'other']`. Add one kind:

| kind | Writer sees | For | Map colour token |
|---|---|---|---|
| `person` | Person | characters | `--canon-person` |
| `creature` | Creature | Bramble, Rook | `--canon-creature` |
| `place` | Place | Corwick, Saltmere | `--canon-place` |
| `thing` | Thing | objects, ships, swords | `--canon-thing` |
| `group` | Group | houses, guilds, armies | `--canon-group` |
| **`rule`** | **Rule or System** | magic, money, laws, distances, calendars ("The Salt Laws", "Coin", "Days on the Road") | `--canon-rule` |
| `other` | Other | anything else | `--canon-other` |

- A `rule` entry's facts are free-label facts (`Other` in the vocabulary). They are recorded and linked but raise no slips in the MVP.
- The reader's `propose` schema gains `rule` in its kind enum. The cue words that send a paragraph to the reader are not widened, so reading costs no more.
- The colour tokens go at the top of `styles.css`, with night-theme values. The map reads them with `getComputedStyle`, so the map and the entry list agree.

---

## 2. Links and backlinks

### 2.1 What makes a link

1. **`[[Name]]` or `[[Name|words shown]]`** in *In my words*. It resolves by name or alias through the same index as `mentions()`. Matching ignores case and folds curly quotes.
2. **Relation facts.** The value of `Sibling`, `Parent of`, `Child of`, `Married to`, `Born in`, `Owner`, `Lives in` and `Other` links when it names an entry or one of its aliases. The file needs no brackets (`- Owner: Tamsin Hale · unverified`), so the entry format in ARCHITECTURE §2.2 does not change.
3. **Renaming never rewrites other entries.** The old name becomes an alias of the renamed entry, so every link keeps resolving. Canon writes no words of the writer's that they didn't ask it to.

On the entry page a resolved link is set like a NEO link: the text colour, underlined on hover. Clicking it opens that entry. An unresolved `[[Saltmere]]` gets a dotted underline. Clicking it offers **Make an entry for "Saltmere"** (name filled in, kind to pick), which is the same as **+ New Entry**.

### 2.2 The two lists at the foot of an entry

Both lists sit below the facts and above *In my words*. They are hidden when empty and folded after 8 items ("Show all 23").

> **Linked from**
> Tamsin Hale · Owner
> Field Notes entry "Horses" · in her words  *(when the link is in In my words)*
>
> **Mentioned in · 31 passages in 3 books**
> *Ember and Thorn*, Ch 2 — "…Bramble, the grey mare, would not cross the ford."
> *The Salt Crown*, Ch 1 — "…Bramble tossed his head and pulled at the reins."
> Field Notes, Horses — "Bramble — mare, eleven, bad-tempered with strangers."

- Clicking a passage opens that book and chapter with the name lit by the `neo-search` Highlight. This is the same as clicking a source today.
- *Mentioned in* is in reading order (shelf order, then chapter order), with notebooks and Notes after. It skips pages that are left out of Canon, and Darlings, as the reader does.
- Snippets are 12 words either side, built on demand. Nothing is stored in the entry file.

### 2.3 Data (`canon.js`, pure, unit-tested)

| Function | Returns |
|---|---|
| `parseLinks(text)` | `[{ target, shown, start, end }]` |
| `entryLinks(entry, index)` | `[{ to, via: 'fact' \| 'words', attr? }]`; unresolved links come back as `to: null, name` |
| `linkGraph(entries, index, together)` | `{ nodes: [{ id, name, kind, mentions }], edges: [{ a, b, why: 'fact' \| 'words' \| 'together', n }] }` |
| `backlinks(graph, id)` | the edges into `id` |
| `paraEntries(paras, index)` | per paragraph: the entry ids it mentions, in order of appearance |

The mention index is the one ARCHITECTURE §2.3 already builds (`mentions`: entry → `[bookId, chId, paraHash]`). One addition while it is rebuilt: `together`, the count of paragraphs in which two entries both appear, kept only for pairs that share at least 2 paragraphs. Both live in the cache, never in the library.

---

## 3. "In this chapter" in the right-hand pane

While writing in a book whose shelf keeps a Canon, the right-hand pane (the same hover pane as the side cards and Find) gets a section below `#side-cards`:

> **In this chapter**
> People — **Tamsin Hale** · Oren Hale · Ilsa Varr
> Creatures — **Bramble** · Rook
> Places — Corwick

- Entries are grouped by kind and listed in order of first appearance in the chapter. Those mentioned in the caret's paragraph are shown in the accent colour, matching how side cards mark the caret's card.
- Hovering a name shows its fixed facts on one line, each a verbatim value ("Mare · grey · Oren's horse"). Clicking a name opens the entry in the Canon tab. ⌥-click opens the entry beside the page instead, in the same pane (Esc goes back).
- The section is computed in the window from `chapterHTML[chId]` with `Canon.sourceParas` and `Canon.paraEntries`. This needs no IPC and no model, and it works with no reader and with hand-kept entries. It refreshes with the side cards' own refresh (`sideCardsUpdate`, already rate-limited with requestAnimationFrame). The pane is hidden while typing, as now, so this costs nothing per keystroke.
- When nothing in the chapter is in Canon, the section is absent. It has no empty-state text.
- Notes tab and notebook pages: the same section, headed **On this page**.

---

## 4. ⌘K — Go to Anything

### 4.1 Key and menu

⌘K (Ctrl+K) is free: no menu accelerator in `buildMenu()` uses it, and `app.js` binds `k` only in vim moving mode, without ⌘. Add **View → Go to Anything…** with accelerator `CmdOrCtrl+K`. Like Spellcheck Pass, it is `registerAccelerator: false`, and the window answers the key itself, so the keyboard layout issue in #282 cannot recur. The command works for every writer. Canon results are added only when the open book's shelf keeps a Canon. P0 #1 is read as "unchanged apart from menu items" (ARCHITECTURE §8 item 9).

### 4.2 What it looks like

A single field near the top of the window, the width of the page, over a dimmed backdrop. It uses `popMenu`'s styling, has no title, and Esc closes it.

> `grey mare`
> **Bramble** · Creature — also called "the grey mare"
> **Sex: female (mare)** · Bramble — "Bramble, the grey mare, would not cross the ford."
> *Ember and Thorn*, Ch 2 — "…Bramble, the grey mare, would not cross…"
> Field Notes, Horses — "Bramble — mare, eleven…"

- Placeholder: "Go to a chapter, an entry, a passage or a command". No results: "Nothing matches "%s"."
- ↑/↓ move through the results and Enter goes. ⌘Enter on an entry opens it beside the page. Each row's right side names its group in small grey type: **Entry · Fact · Chapter · Passage · Command**.
- With an empty field it shows the 8 most recent picks, kept per device in `localStorage` under `neo.goRecent`.

### 4.3 Sources and ranking

| Group | Searched text | Where it comes from |
|---|---|---|
| Entry | name, aliases | window (parsed entries) |
| Fact | label, value, as-written word, source quotes | window |
| Chapter | chapter and page titles of the open book, then other books on the shelf | `book`, `listBooks` metadata |
| Passage | paragraph text, open book first, then the shelf | open book in memory; others through `canon:search` |
| Command | menu labels with their submenu path ("Export › Paperback for KDP…") | `menu:items` |

- Scoring is one pure function, `goScore(query, text)`. An exact match scores above a prefix of the whole text, which scores above a prefix of a word, which scores above a subsequence. The score is multiplied by the group's weight (Entry 1.0, Command 0.9, Chapter 0.85, Fact 0.8, Passage 0.6) and gets a bonus for recent picks.
- A fact or alias hit lifts its entry to the top. That is how "grey mare" finds Bramble.
- Passages need at least 3 characters. They are searched on `norm()` text and capped at 20 results.
- Searching is synchronous for the window's own data. Shelf passages arrive afterwards and are merged in, and a stale reply is dropped by sequence number.
- `goScore` and `goRank` live in a marked block in `app.js` (a GO TO ANYTHING section). That way the palette also works with Canon off and in Pocket, and a test can load the block through `vm`, as `snapshots.test.js` does.

---

## 5. The map

### 5.1 Decision: hand-rolled canvas, no three.js

The map uses one new file, `map.js` (`window.NeoMap`, loaded like `covers.js`). It is about 300 lines:

- a seeded force layout in 3D: repulsion O(n²), springs along edges, gravity to the centre;
- 300 iterations to settle, then idle (no animation loop while still);
- orthographic projection for **2D** (z flattened to 0 and the layout re-settled) and simple perspective for **3D**: rotate around y and x by dragging, zoom with the wheel or a pinch;
- hit-testing nodes in screen space.

A world of a few hundred entries is well within O(n²). Three.js would add 600 KB of vendored code for spheres and lines that `arc()` and `lineTo()` already draw. The file satisfies CSP `script-src 'self'` and works offline.

### 5.2 The small map (widget)

- It sits at the top of the Canon tab's right-hand pane, above Needs You, and is 180 px tall.
- It shows the open entry and its neighbours one step away. With no entry open it shows the whole world.
- Clicking a node opens that entry. Clicking the widget's corner button **Open the Map** opens the full view.

### 5.3 The full view

Open it with **View → World Map** (⌘⇧M, which is not otherwise used) or from the widget. It replaces the Canon tab's page area, and Esc or the tab returns to the entry.

- **Nodes:** circles coloured by kind and sized by mentions (square root, clamped), with names drawn beside nodes above a size threshold or on hover.
- **Edges:** solid for links (fact or *In my words*) and faint for **appear together**, which is off by default. The toggle is labelled "Show who appears together".
- **Controls**, hidden until hover, in a corner: **2D · 3D** toggle, and a kind legend in which clicking a kind hides or shows it ("People", "Creatures", "Places", "Things", "Groups", "Rules and Systems", "Other"). There is also a field reading "Find on the map" that centres and pulses the matching node. ⌘K while the map is up does the same.
- **Mouse and keys:** clicking a node opens its entry, and hovering shows its name and kind. In 2D, dragging the empty background pans; in 3D it rotates. Dragging a node pins it until the view is closed.
- **Per device:** 2D/3D, hidden kinds and the together toggle are kept in `localStorage` (`neo.mapLook`), like the shelf zoom. Positions are not saved. Instead the layout is seeded from entry ids, so the same world lays out the same way every time.
- A Canon with no entries says "The map fills in as Canon learns your world."

---

## 6. IPC and files

| Addition | Where | Args → returns |
|---|---|---|
| `canon:index` | `main.js` handler, `canonIndex` in preload | `canonId` → `{ mentions: { id: n }, together: [[a, b, n]], byChapter: { "bookId/chId": [ids] } }` |
| `canon:mentions` | handler, `canonMentions` | `canonId, entryId, { limit }` → `[{ bookId, chId, title, snippet, start }]` in reading order |
| `canon:search` | handler, `canonSearch` | `canonId, q, seq` → `{ seq, passages: [...] }` (`norm` substring over cached `sourceParas`, max 20) |
| `menu:items` | handler, `menuItems` | → `[{ path, label, accelerator, enabled }]`: a walk of `Menu.getApplicationMenu()`, skipping separators, roles without a label, and disabled items |
| `menu:run` | handler, `menuRun` | `path` → calls that `MenuItem`'s `click()` with the focused window, so a command behaves exactly as if it were picked from the menu |

Files touched:
- `canon.js`: `KINDS` gains `rule`, plus §2.3's functions (about 120 lines).
- New `map.js` (about 300 lines).
- `app.js`: the CANON section gains the links, backlinks and In this chapter (about 200 lines), and a new GO TO ANYTHING section (about 180 lines).
- `main.js`: 5 handlers and 2 menu items (about 80 lines).
- `preload.js`: 5 methods.
- `index.html`: `<script src="map.js">`.
- `styles.css`: kind tokens, palette, map chrome (about 120 lines).
- `scripts/pocket-www.js` does not copy `map.js`. In Pocket, `app.js` checks `window.NeoMap` before offering the map.

---

## 7. Tests

**Unit (`npm test`, no model)**
- `scripts/canon-links.test.js`:
  - `parseLinks`: piped forms, `[[` with no closing brackets, links next to punctuation.
  - Resolving through aliases and case.
  - A rename keeps links resolving.
  - `linkGraph` on the fixture: Tamsin–Bramble (Owner), Tamsin–Oren (Sibling), Ilsa–Saltmere (Born in).
  - `backlinks`.
  - `paraEntries` on Book 2 Ch 1 lists Bramble and Ilsa.
  - `together` drops pairs that share only one paragraph.
- `scripts/go.test.js` (the `app.js` block through `vm`):
  - "grey mare" ranks Bramble first.
  - "pap kdp" finds "Paperback for KDP…".
  - Exact matches beat prefixes, which beat subsequences.
  - Recent picks get the bonus.
  - Stale `seq` replies are dropped.
- `scripts/map.test.js` (`map.js` through `vm`, with no canvas):
  - The layout is deterministic for a given seed.
  - It settles within 300 steps on 300 nodes in under 200 ms.
  - 2D gives z = 0.
  - Projecting a node and then hit-testing that point returns the node.
  - Hidden kinds drop their nodes and edges.
- The fixture gains a `rule` entry, "The Salt Laws", with `[[Corwick]]` in its words, and a notebook page that links `[[Saltmere]]` while no Saltmere entry exists (the unresolved case).

**e2e (`scripts/canon.e2e.js`, `xvfb-run -a npx electron --no-sandbox …`)**
- In this chapter:
  - Open *The Salt Crown* Ch 1 and hover the right edge. The section lists Bramble and Ilsa Varr.
  - Clicking Bramble opens its entry.
  - With Canon off, the section is absent.
- Backlinks: Bramble's entry shows *Linked from* Tamsin Hale. *Mentioned in* has the Ch 2 quote, and clicking it lands on Ch 2 with `neo-search` lit.
- Palette:
  - Send ⌘K/Ctrl+K, type "grey mare" and press Enter. The Canon tab shows Bramble.
  - Type "snapshot" and press Enter. A snapshot is taken.
  - Esc restores the caret where it was.
- Map:
  - Open View → World Map. `NeoMap.nodes().length` equals the entry count.
  - Clicking the screen position of Rook (from `NeoMap.screenPos('rook')`) opens Rook.
  - Toggle 3D, drag, and assert that the projected positions changed.
  - Check that nothing was written into the library while browsing: chapter and entry mtimes are unchanged.
- Screenshots (`wc.capturePage()` → PNG in the run's temp folder, for a person to look at, not pixel-compared):
  - the In this chapter pane;
  - the entry page with both lists;
  - the palette with "grey mare";
  - the map in 2D and 3D, in day and night themes.
- Each screenshot is also checked to be non-blank: more than one distinct colour in the map area.

---

## 8. Build order (after M11)

12. **M12 — Kinds, links, backlinks.** Add `rule` to `KINDS` with a picker label and colour tokens. Add `parseLinks`, `entryLinks`, `linkGraph`, `backlinks` and `together` in the index rebuild, then `canon:index` and `canon:mentions`. On the entry page: link rendering, unresolved links → Make an entry, and the *Linked from* and *Mentioned in* lists. Rename adds the old name as an alias. *Accept:* `canon-links.test.js`; the e2e backlinks checks; renaming Bramble keeps Tamsin's Owner link.
13. **M13 — In this chapter.** `paraEntries` and the side-pane section, with caret highlighting, hover facts, click and ⌥-click; **On this page** for Notes and notebook pages. *Accept:* the e2e pane checks; typing latency unchanged (rerun ARCHITECTURE M7's latency test with the pane open).
14. **M14 — Go to Anything.** `menu:items`, `menu:run`, `canon:search`, the GO TO ANYTHING section, the View menu item and the ⌘K key in the window. *Accept:* `go.test.js`; the e2e palette checks; with no Canon the palette shows only chapters, passages and commands.
15. **M15 — The map.** `map.js`, the widget in the Canon tab, the full view (View → World Map, ⌘⇧M), 2D/3D, the legend, find, and `neo.mapLook`. *Accept:* `map.test.js`; the e2e map checks and screenshots; a 300-entry synthetic Canon stays smooth while rotating (frame times under 16 ms, measured in the e2e).

**Cuts kept deliberately small**
- No link autocompletion while typing in *In my words*. Typing `[[` offers nothing; ⌘K finds names. This keeps "nothing interrupts a writer" intact.
- No saved map positions. Seeding the layout from entry ids gives a stable layout with nothing to sync.
- No backlinks inside chapters: the manuscript is never marked with links.

---

## 9. Decisions made while building M12–M15

1. **Direction of a link.** A link runs from the entry that holds it to the entry it names: Bramble's `Owner: Tamsin Hale` is an edge Bramble → Tamsin, so *Linked from* on Tamsin's page lists "Bramble · Owner", and Bramble's own page shows Tamsin as a link among its facts. §7's "Bramble's entry shows *Linked from* Tamsin Hale" is tested with Tamsin's *In my words* holding `[[Bramble]]` ("Tamsin Hale · in my words"). `backlinks` leaves out *appear together* edges.
2. **Fixture additions** live in `scripts/fixtures/canon/ide/` (`the-salt-laws.md`: a `rule` entry, aliases `salt tax`, words with `[[Corwick]]` and `[[Saltmere|the coast]]`), not in `library/`, so every M0–M11 test still starts from an empty Canon. The unit test reads it beside `expected.json`; the e2e copies it into the Canon after Read the Shelf. The unresolved case is `[[Saltmere]]` before Saltmere has an entry (the unit test leaves Saltmere out); notebook pages are not link sources (the manuscript and its pages are never marked with links), so the e2e's unresolved link is `[[Ashby]]` in Tamsin's words.
3. **Shapes.** `linkGraph(entries, index, world)` takes canon:index's whole answer (`mentions` sizes the nodes, `together` adds the faint edges). `canon:mentions` returns `{ total, books, passages: [{ bookId, chId, book, label, notes, notebook, para, snippet, at, span }] }` (the header needs the totals). Mentions count paragraphs, not occurrences. `resolveName` tries names, then aliases, then a person's unshared name parts. The reader's `propose` kind enum gains `rule`; the prompt text is unchanged, so no cached proposal is asked again.
4. ***In my words*** shows `[[links]]` set as links until it is clicked into (or tabbed to); then it is the file's text, brackets and all, and blurring saves it as before. A relation fact's value that names an entry is a link on the entry page. **Rename** keeps the old name as an alias and drops the new one from the aliases.
5. **Passages open lit by `neo-search`** (Find's own highlight) on the name only, found by the snippet's text and then the name's offset in it; any key or click clears it.
6. **Kind colours** are bright on the dark room and the night page (`:root`), deeper on white paper and in the light theme (`body.light, body:not(.night) #aux-paper`).
7. **In this chapter** sits in `#canon-here`, right after `#side-cards`. It is worked out only while the pane is open (or when its hot zone is entered), from `chapterHTML` (kept current on every input) with `sourceParas` + `paraEntries`, memoised on the HTML string, so with the pane pinned open a key costs a string compare and one paragraph's `mentions` (the e2e measures under 4 ms a call). Kind rows wear a small dot in the kind's colour. Hovering a name shows its *yours* and *checked* values (as written) on one line under the list. ⌥-click sets the entry page, small, into the pane in place of the side cards and Notes & Comments; Esc (caught before the page's own Esc, which goes back to the shelf) or "← In this chapter" returns. A page left out of Canon still lists who it names (it is a way around the world, not a fact).
8. **Go to Anything.** View → Go to Anything… (`CmdOrCtrl+K`, `registerAccelerator: false`); the window answers ⌘K/Ctrl+K itself in a capture listener, in the editor and on the shelf, unless a dialog is up. `goScore` tiers: exact 1, prefix of the whole text 0.8, prefix of a word 0.6, anywhere 0.5, each query word starting a text word in order 0.4 ("pap kdp"), letters in order 0.10–0.25 by how close together they are; text is folded (case, accents, curly quotes, dashes). A recent pick gets up to +0.15. A fact that answers lifts its entry to the fact's own score + 0.25, so "grey mare" (a source quote of Bramble's facts) puts Bramble first. Fact rows search label, value, the as-written word and source quotes, and show the quote that matched. Commands come from `menu:items` (full path as the key; shown without the top menu's name; the palette's own item left out) and run through `menu:run`. Passages: the open book's paragraphs as the page stands, then the shelf's from `canon:search` (debounced 120 ms, a stale `seq` dropped), 20 at most; a picked passage opens lit like Mentioned in. Recent picks keep what they need to run again (`neo.goRecent`, 8). Esc closes and puts the focus and caret back; a picked command also runs with the caret back where it was. With no Canon the palette has chapters (the shelf's other books too, from `shelfMeta`), passages and commands. Pocket has no `menuItems`, so no commands there.
9. **The map (`map.js`, ~560 lines with comments).** UMD like `canon.js` (`window.NeoMap`; `require` in the tests). Layout: Fruchterman–Reingold on typed arrays, ideal spacing 60, links pull with weight 1 and *appear together* with 0.18, gravity 0.06, the step capped by a heat that cools linearly over 300 steps; 300 nodes settle in ~70 ms here. Initial positions come from an FNV hash of each id, and the map sorts nodes by id first, so the same world always lays out the same way (the order of `canon.entries` doesn't matter). 2D is its own layout, re-settled (160 steps) from the 3D one with z = 0; switching animates positions, turn, perspective and framing together over 700 ms. Framing centres the world and fills the room, keeping clear of the controls; in 3D it frames what is drawn at the current turn.
10. **Looks.** Each kind's node is a sprite drawn once per colour (a soft glow and a lit sphere) and stamped with `drawImage`; links fade from one kind's colour to the other's (a plain blend above 120 nodes, and smaller halos, to keep a frame cheap); *appear together* is dotted and faint. In 3D, far nodes are smaller and dimmer and are drawn first. Hovering lights a node and its neighbours and dims the rest; its kind shows under its name. Names are placed largest first, beside the node (on the right, else the left; in the small map under, else over), never over a name already placed, with a halo of the background so lines don't cut through them. A turn let go of carries on and slows; dragging a node pins it (a ring) and its neighbours follow for a moment. Nothing animates while the map is still. The dark map is a soft radial gradient with a little fixed dust; the light theme gets a warm paper version. Measured with a pixel read-back each frame, a 300-entry world turns at ~9 ms a frame (90th percentile) in this VM's software renderer (the e2e asserts < 16 ms).
11. **The full view** covers the window above the bottom bar (not just the page column), and the right-hand pane steps aside while it is up. Controls are one translucent card in the top-right corner, hidden until the map is hovered: 2D · 3D, Find on the map (also ⌘K while the map is up; it centres and pulses the best match by name or alias, using `goRank`), the legend (only the kinds present), and "Show who appears together". The shelf's name sits faintly top-left. Esc (caught before the page's own Esc), the tabs, ⌘⇧M again, or opening an entry close it. View → World Map is `registerAccelerator: false` and the window answers ⌘⇧M; without a Canon it says so in a toast.
12. **The small map** is always flat (a few neighbours read best without perspective), shows the open entry and those one step away (or the whole world), and labels only those. It needs no reader: the Canon tab's pane now opens whenever `map.js` is there. Sizes and *appear together* come from `canon:index`, asked again when the entries change or the full view opens.
13. **Leftovers from M9–M11.** Apply All Shown and Stop Reviewing now sit on one line in the 250 px pane (no wrapping, a little less padding). After ⌘Z in the open book, a passage that reads as it did before its Apply is *to do* again (checked on `input`, 150 ms after the last, only for the open book's applied passages; another book's change is undone through Snapshots → Restore, which the list can't see).
14. **e2e.** `scripts/canon.e2e.js` has 26 checks. `CANON_SHOTS=1` writes every screenshot; `CANON_SHOTS=map,go-any` only those whose names hold one of the parts. Keys and hovers sent while the window settles are sent again until they land (`until2`). `CANON_THEME=light CANON_SHOTS_DIR=<folder>` writes the IDE views in another theme somewhere else, to look at (the light theme's Canon list field and + New Entry were dark; fixed). New screenshots: `canon-entry-backlinks.png`, `canon-in-this-chapter.png`, `canon-go-anything.png`, `canon-map-widget.png`, `canon-map-2d-night.png`, `canon-map-3d-night.png`, `canon-map-2d-light.png`, `canon-map-3d-light.png`.

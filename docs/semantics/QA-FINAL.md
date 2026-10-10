# QA-FINAL: Canon (branch semantics @ 7a41e9d), run in a copy at /tmp/claude-0/qa2

Scripts: qa/*.js (harness.js, flow3..15, flowreal*.js; real mouse/key events via `sendInputEvent`). Shots: qa-shots/ (my flows, `-dark`/`-light`) and qa-shots/e2e-dark, e2e-light (canon.e2e CANON_SHOTS=1). Raw logs: flow*.out, lightflow*.out, flowreal*.out.

## 0. Suite results

| Run | Result |
|---|---|
| `npm test` | 149 pass, 1 skipped (CANON_REAL), 0 fail |
| `CANON_REAL=1 node --test scripts/canon-reader.test.js` | passes (244 s), but it only checks Bramble's 3 chapters (see F1) |
| `npm run lint` | 31 errors, inside the 29-31 baseline, none in canon.js, map.js or the Canon code I could attribute |
| `canon.e2e.js` | 26/26 |
| `words.e2e` 18/18, `caret.e2e` 14/14 | pass |
| `tabs.e2e` | 7/9. 2 FAIL ("View → Go to…", "the menu items switch tabs": `Menu…find(label === 'View')` is undefined). **Identical on the pre-Canon base 189ecc0~1, so not a regression.** |
| `node scripts/i18n.js template` | no diff (987 strings), but plural forms are missing for some new strings (F10) |
| Own flows | 14 files, about 130 checks; every item below was seen with real key/mouse events unless marked "(code)" |

Prior QA (QA-M0-M4) fixes re-verified: #1 (tiedTo) holds on the fixture; #2/#3 (one-line fields, BOM, unreadable files: garbage/empty/half entries are listed, preserved byte-for-byte, and a canon.json / not-slips.json corrupted on disk are restored from .bak with a log line); #6 (marks after ⌘Z: 1 mark returns); #8 (same name refused, also on rename); #15 (Keep a Canon opens the tab); #18, #21 (entries/facts plurals only: "1 passages" still shows, F10). **Incomplete fix: #24 (hard-coded greys)** still breaks the light theme, F5.

## 1. Findings

Severity: blocker / major / minor / nit.

### Blocker

**F1. The real reader (Quick, Qwen2.5-1.5B) builds a Canon with false "verified" facts, and the Continuity Pass then flags correct prose (P0 #13 fails with the real reader).**
Repro: real app (NEO_CANON_* unset, network proxy dead), the fixture shelf with `qwen2.5-1.5b-instruct-q4_k_m.gguf` in userData/models, Read the Shelf (590 s, 10 chapters, 1,998 words). Result "17 facts, 13 checked out, 4 need you". Every quote is verbatim (24/24: P0 #6 holds), but of the 13 "verified" facts at least 6 are wrong:
- `Ilsa Varr · Owner: Ilsa Varr` (quote "Captain Varr knelt beside him in the water")
- `Oren Hale · Parent of: Tamsin` (quote "Tamsin, the elder of the two Hales")
- `Rook · Parent of: Oren Hale` (quote "Rook — stallion, Oren's")
- `Tamsin · Sibling: Ilsa Varr` (the same "knelt beside him" quote)
- `Ilsa · Lives in: Corwyck` (the misspelling of the town taken as a place she lives)
- `Ilsa · Eyes: brown · verified`, taken from the seeded slip ("Ilsa's brown eyes narrowed") while the book 1 grey eyes were missed.
Also junk entry "Ponies", "Tamsin" without "Hale", and a dialogue lie as a source of Species.
Continuity Pass with these facts: *Ember and Thorn* (correct book 1): 2 false slips, "Captain Varr's eyes were the grey of wet slate" (Ilsa eyes) and "He spat into the shallows." (Bramble pronoun). *The Salt Crown*: 3 of 5 P0 slips found (his, Corwyck, stallion); "brown" and "elder" missed.
Expected: wrong flag worse than a missed one (pillar 3). Actual: the Checking pass (canon.js judge, `tiedTo`) says "supported" to nearly anything the 1.5B model proposes, and a later book's slip becomes established fact. With the fake reader the pass gives exactly 5/5, 0 decoys. **Careful reader (Qwen3-4B) not run (about 25 min here).** Suggest: Quick tier verifies nothing (unverified only), relation attrs (owner/parent/child/sibling/spouse/home) never verified by the model alone; a fact that contradicts an earlier book's quote goes to `disagree`, not "verified".

### Major

**F2. "New Entry" typed with Enter skips the kind chooser and silently makes a Person.** Repro: Canon tab, + New Entry, type "Biscuit", press Enter: the entry is Person, the kind menu was never visible (clicking OK instead shows the menu). Cause: askInput resolves on Enter keydown (app.js:400-401); `canonNewEntry` (app.js:16783) then opens `popMenu` whose first button is focused (app.js:505) before the same key's keypress/keyup, which clicks it. Same path for every keyboard user.

**F3. ⌘'/Ctrl+' with the reader installed sits on "Checking…" for ≥10 s.** Measured 10,051 ms on the 3-chapter fixture, 12.1 s on a 50k-word chapter (0 s with no reader). The shortcut's own keydown calls `canonTyping` (app.js:18088-18091), which pauses the reader for 10 s (main.js:2623-2639). PRODUCT §4.5/§5 #8: a pass the writer started is exempt. Starting the pass from the menu with the mouse avoids it.

**F4. Duplicate entry when a hand-written entry starts with "The".** Hand entry "The Salt Law" + Read the Shelf, reader entity "The Salt Law" → a second rule entry "Salt Law" (`accept` strips the article for the new name, `findEntry` looks up the unstripped one: canon.js:947-953). In this chapter lists only "Salt Law"; map shows both, the second unlinked. Merge Into works afterwards, but this will hit every named place or thing with an article.

**F5. Light theme: the Continuity Pass list's entry names are unreadable.** `#canon-side .cs-slip { color: #ccc }` (styles.css:2207) has no `body.light` override (only `.cs-need strong`, `q`, `.cs-src` have). "Bramble · Ch 1" name is #ccc on #efede8 (about 1.4:1). Screenshots 08/09/23-light. Also `.cs-note` #888 italic on the light pane is about 3.3:1. The fix for prior QA #24 was incomplete.

**F6. Slip popover never closes by itself.** Hover a mark, move the mouse away without entering the popover: still open after 3 s; stays after scrolling the page (floats detached over other text); stays while typing a key; Esc is the only way out. Only `pop.onmouseleave` is wired (app.js:17719-17783). The writer is typing under a popup. Rule: "No popups while typing".

### Minor

**F7. Changing a fact across the series keeps a dialogue lie as the source of the new "yours" fact.** After "Bramble is now a stallion…" the entry has `Sex: male (stallion) · yours` with the source "That's no mare, that's a gelding" `{said:the horse-trader}`: the existing unverified same-value fact is promoted instead of replaced (canon.js:575-579 `had`). A quote that says "gelding" now backs "stallion".

**F8. Review summary undercounts.** After Apply, Skip, Edit…, Apply the line reads "2 passages changed, 1 skipped" for 3 changes (app.js:17833: `changed` counts only `applied`, not `edited`).

**F9. ("Needs your words" counted nowhere) The finish line ignores the "Needs your words" passage as well**; PRODUCT §4.7 #7 "6 passages changed, 1 skipped" has no slot for it either. Spec gap.

**F10. Plurals.** "MENTIONED IN · 1 PASSAGES IN 1 BOOK" (app.js:17309), "Review Changes · 1 passages in …" (17827), "{n} passages changed" (17836): `{n} passages` has no `one` form in locales/en.json (entries/facts/need you do).

**F11. World Map Find: Esc closes the map, a second Esc leaves the book.** `find.onkeydown` Esc (app.js:18206-18210) is dead because the document capture handler (app.js:18289) closes the map first. Repro: ⌘⇧M, click Find, type, Esc, Esc → back on the shelf with the book closed. Expected: first Esc clears the field.

**F12. Map opened from the Manuscript tab leaves the right-hand pane over it.** IDE §9.11: the pane steps aside. `mapOpen` (app.js:18174-18200) switches to the Canon tab, which opens the pane after the "close" line ran; screenshots 18/20 show Needs You/Dismissed and an empty "Notes & Comments" block beside the map. (Opened from the Canon tab it is fine: e2e shots.)

**F13. A directory named `*.md` in `entries/` breaks the whole Canon tab.** `canon:open` rejects with EISDIR (main.js:2218 `readFileSync` on every dirent). Sync tools make conflict folders; one bad entry should not take down the list.

**F14. Windows-reserved entry names.** An entry "CON" becomes `con.md` (also prn, aux, nul, com1…). iCloud/Syncthing to Windows cannot create it (canon.js `slug`).

**F15. ⌘K fuzzy noise.** "mare" lists "Smaller Text Ctrl-Minus", "Markdown Emphasis", "Email Draft to Myself" among results; "snap" lists "Polski Spellcheck Language", "Blank Page New Books Open To"; one letter returns 40 rows. The letters-in-order tier (0.10-0.25, app.js:16228) is too permissive for short queries.

**F16. New Notebook focuses nothing.** Typing "Horses" straight away goes nowhere (a New Book focuses the title). The page title and body need a click first (app.js:6998-7009).

**F17. Real reader speed.** 590 s for 1,998 words / 10 chapters on 4 CPU cores (no GPU): the progress estimate was honest ("about 8 minutes"), but the spec's "112,400 words about 40 minutes" would be about 9 h here. Copy/expectation issue; keep the setup page honest about CPU-only machines.

### Nit

**F18.** Quiet check lands about 10 s after the quiet threshold (the reader's resume delay on top; 9.5 s after a 2.5 s test timeout), so about 100 s, not 90 s.
**F19.** "Needs You" offers "That's right" on a dialogue-only fact ("Sex: male (gelding)?" said by the horse-trader).
**F20.** Copy drift: setup page still says "…or let Canon read the shelf" with no reader; "Careful reader · 2.5 GB" (spec 5.2 GB); "Licence: Apache-2.0" is plain text, not a link (§4.1 #7); an empty entry file reports "line 1".
**F21.** On shelves without a Canon: an empty `#canon-here` div stays in the side pane (invisible), and the View menu has Go to Anything… and World Map (the spec text says only the two Edit items; IDE.md accepts them). ⌘⇧M shows a toast.
**F22.** Popover buttons wrap ("Not a slip" alone on a second row); "REVIEW CHANGES · 5 / PASSAGES IN 3 BOOKS" breaks mid-phrase in the 250 px pane.
**F23.** Deleting `userData/canon-cache` while the app is open makes "Mentioned in" vanish until relaunch (relaunch rebuilds it and leaves entries byte-identical: P1 #21 passes).
**F24.** 3,000 entries x 500 paragraphs: `mentions` 1.6 s (about 3 ms/paragraph), a main-thread block each time In this chapter recomputes; fine for normal worlds.

## 2. PRODUCT.md §5 checklist (§6 in the file: P0 1-13, P1 14-23, P2 24-26)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | No reader / no Canon: NEO tests pass, UI unchanged | PASS | npm test 149/150; words/caret e2e pass; tabs.e2e 2 FAIL are pre-existing on base; no Canon tab/pane content/palette Canon rows on a plain shelf; menu adds items (F21) |
| 2 | No network except Download after press | PASS | main-process net log empty through a real 590 s read, passes, and offline; Download press made exactly 1 request (HF URL) |
| 3 | One-button download, progress, resume, checksum | PASS | e2e (pause, Range resume, ready); size+sha256 in `downloadFile`; offline: "NEO can't reach the download…" + Try Again. Quit-resume by code (.part kept), not run for real |
| 4 | Weights outside library; no Canon file >1 MB | PASS | userData/models; no canon file >1 MB in any run |
| 5 | Keep a Canon creates canon-<slug>-<shelfId>/ with canon.json + entries/ | PASS | seen after a real right-click flow |
| 6 | Every model fact has a verbatim source quote | PASS | real run 24/24, fixture 21/21 (after Apply, quotes edited by the writer go stale until re-read, as designed) |
| 7 | Quote not found: never verified, no slip | PASS | unit tests; no unfound quote verified in real/fake runs |
| 8 | No slip mark within 90 s of a key, except a started pass | PASS | 9 s continuous typing with 2.5 s timeout: 0 marks/popovers/focus changes; marks appear after the writer stops. (F6: a hover-opened popover persists while typing) |
| 9 | Marks never in chapter HTML | PASS | DOM body and files on disk checked after pass, Apply, ⌘Z |
| 10 | No manuscript change without Apply | PASS | chapter bytes identical after read/pass/quiet check; changed only after Apply/Edit… |
| 11 | Change-across-series snapshots, restore byte-identical | PASS | `r` snapshots of Ember and Field Notes hold the pre-change bytes; Salt Crown (open) covered by the day's `d` snapshot; ⌘Z returns 3/3 chapters byte-identical. Snapshots → Restore UI not driven |
| 12 | Typing latency within 10% | PASS | keydown-to-paint p50 6.2-7.9 ms Canon off vs 6.3-7.3 on, 50k-word chapter, pane pinned open; 2 ms p50 while the real reader ran (it paused, resumed after ~14 s) |
| 13 | Fixture: all 5 P0 slips, no decoys | **FAIL with the real Quick reader** (3/5, plus 2 false slips in book 1); PASS with the fake reader (5/5, 0 decoys). Careful not run (F1) |
| 14 | Notebook tile distinct, no progress bar/numbers | PASS | cloth tile seen; "Pages", page names |
| 15 | Notes + notebook pages feed Canon; Darlings/stickies/placeholders/card notes don't | PASS | `canonSources` (main.js:2313) reads chapters, notes.html, notebook pages only; real run read Notes and Pages |
| 16 | Leave Out of Canon | PASS | e2e |
| 17 | Hand facts survive Read Everything Again | PASS | flow12: identical `· yours` lines |
| 18 | Not a slip persists; edited sentence returns | PASS | cosmetic trailing space: stays dismissed; "Then …" prefix: flagged again |
| 19 | Edited cited passage → "This passage has changed" | PASS | tag + `changed` in file after the quiet re-read |
| 20 | Only changed chapters re-read; idle writes nothing | PASS | no Canon file written in 45 s idle (book.json `lastPosition` is rewritten with Canon off too: NEO base) |
| 21 | Delete cache, reopen: rebuilt, entries unchanged | PASS | relaunch, entry files byte-identical |
| 22 | Set-aside entries and facts restorable | PASS | entry Restore button; fact Restore (e2e) |
| 23 | New strings in the i18n template | PASS (gap) | template unchanged; `{n} passages` plural missing (F10) |
| 24 | Merge Into combines aliases/sources, file in set-aside/ | PASS | alias kept, `the-salt-law.md` in set-aside/ |
| 25 | External edit picked up on focus | PASS | alias and words appeared after blur/focus |
| 26 | Two devices, idle: no conflicting writes | PASS (inferred) | idle = zero Canon writes; no two-device run |

**26 items: 25 pass, 1 fail (96%).** The one fail is the one that matters most (F1).

## 3. Other things checked that held up

- Real flow end to end: new shelf → Keep a Canon → New Book (typed prose) → New Notebook → hand entries with [[links]] → Pass (no reader: strong slips only) → hover → Not a slip → Keep: mare/green Apply → ⌘Z → install reader → Read the Shelf → ⌘K → map 2D/3D (click a node opens the entry, drag rotates, Find, legend) → In this chapter follows the caret (click, arrows) → Merge Into → Dismissed restore → relaunch.
- Links: `[[ ]]`, `[[]]`, unclosed, nested are inert or sane; parseLinks 0 ms on 20,000 nested openers. Unresolved link offers "Make an entry for …". Rename keeps the old name as an alias and links still resolve; rename onto an existing name is refused; setting aside a linked entry makes links unresolved, restore brings them back.
- Entry names: emoji, Arabic, Hebrew, quotes, brackets, `| `, `../../evil`, `.hidden`, `---`, `# x`, `<img onerror>`, 300 chars, NFD: all created, parse back, render as text (no injection, no file outside entries/).
- ⌘K: empty query, nonsense ("Nothing matches"), `([`, HTML, 1 letter, Esc restores the caret exactly, ⌘Enter opens beside the page; with no Canon: chapters, passages, commands only.
- 50k-word chapter: opens 0.2 s; ⌘K frame after key 3-15 ms; map 87 ms; paste of 50k words 7.8 s (NEO base).
- Offline: no change in behaviour; pass and read need no network.

## 4. Not covered

Careful reader (Qwen3-4B) quality; Pocket (no Canon by design, `CANON_ON` gating checked by reading only); real quit/relaunch mid-download; Snapshots → Restore UI after a change-across; two devices.

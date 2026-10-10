# NEO Canon: final verification (QA3)

Copy of branch `semantics` at e812fcf, in /tmp/claude-0/qa3. The repo was not touched. Scripts I wrote are in qa/, screenshots in shots/. No real-model eval was run.

## Results

- `npm test`: 167 tests, 166 pass, 0 fail, 1 skipped.
- `npm run lint`: 29 errors in the repo's own files, against 31 on the pre-Canon base. No new errors. The count shows 31 only because my qa/ scripts add 5.
- `canon.e2e.js`: 28/28 on 3 runs, plus a 4th run with screenshots. No flakiness seen.
- `words.e2e.js`: 18/18. `caret.e2e.js`: 14/14.
- `tabs.e2e.js`: 7 pass, 2 fail ("View -> Go to", "the menu items switch tabs"). Pre-existing: the base has no View -> Go to submenu (`git show 94e2648^:main.js` has no 'Go to').
- Regressions or fake fixes among the "Fixed" rows of QA-FINAL section 5 and UX-REVIEW section 4: none found. Details are in the last section.
- New findings: 0 blockers, 0 majors, 4 medium, 8 low.

## Findings

**1. [Medium] The window title and About show "NEO", not "NEO Canon", once the app is running**
- Repro: launch the app. `win.getTitle()` is "NEO Canon" for the first instant, then "NEO" on the shelf and "The Ford -- NEO" in the editor. Help -> About NEO opens an in-window card that reads "NEO / Version x / A word processor for authors." It does not mention NEO Canon or Hugh Howey.
- Expected: the title and About say NEO Canon (UX-REVIEW 23, RENAME.md).
- Cause: app.js:537 overwrites the `<title>` set in index.html:7. app.js:16055 `showAbout` has a hard-coded `<h2>NEO</h2>`.
- The macOS native About panel (main.js:3532) is correct, but that call runs only on darwin and only when a dev icon exists. A packaged Mac gets the name from productName.

**2. [Medium] A name can come out as "Then Mara", and a fact is checked against it**
- Repro: `node --test qa/adv2.test.js`, case T3. Shelf text is "Then Mara lived in Kelsharow." plus other "Mara" sentences. After `readShelf`, the only entry is "Then Mara" (home: Kelsharow, verified). The reader had proposed "Mara".
- Expected: an entry named "Mara".
- Cause: canon.js:979-985 `shelfNames` treats any two capitalised words in a row as a full name. Its only guard is that neither word appears in lower case somewhere on the shelf. A short draft that never writes "then" in lower case defeats the guard, as does any sentence-opening adverb written in lower case nowhere. `accept()` then resolves "Mara" to "Then Mara", because that is the only full name containing it.
- A new writer with a short first chapter is the most exposed.

**3. [Medium] Setup page says nothing about how long reading takes without a GPU**
- Evidence: ACCURACY.md measures 285-493 s of model time for 2,000 words, which is hours for a novel. The "Download and Read the Shelf" page (shots/j08-canon-setup.png) says only "When it's here, Canon starts reading -- you can keep writing."
- This is QA-FINAL F17 and UX-REVIEW 12, still open and documented. It is the first honest-copy gap a new writer meets.

**4. [Low] Shortcuts sheet gives the wrong tab order**
- Repro: Ctrl+/ on a book that keeps a Canon. The line "Go to the next tab" reads "Manuscript, Notes, Outline, Darlings, Canon".
- Actual order: Manuscript, Notes, Outline, Canon, Darlings. The bottom bar shows this, and `TAB_ORDER` at app.js:4763 has it.
- Cause: app.js:14183. UX-REVIEW 3 is marked Done, but the text it added is wrong.

**5. [Low] The map opens in 3D**
- UX-REVIEW 22 says "Keep the 3D map a toggle and never the default". Status: "No change".
- Actual: `mapLook()` at app.js:18277 defaults to `mode: '3d'`. shots/j20-map.png shows it.

**6. [Low] False slip on reported speech**
- Repro: hand entry Pip (Sex: female), text "Tom said Pip was a gelding." The pass flags "gelding" -> Pip.
- Quoted speech is gated ("Pip is a gelding," said the trader: no slip), but indirect speech is not.
- Cause: the speech gate in canon.js `checkSources` looks only at quotation marks. Repro in qa/slips.test.js. Many other probes were safe: three-name relations, pronouns across two people, "Tom looked at Pip. He nodded.", plans.

**7. [Low] Article helper**
- Cause: `tA` at app.js:~17852 rewrites every "a " before a vowel in the finished sentence.
- Repro: it yields "Ida is an unicorn." for a hand-entered species, and it would also change a name ending in "a" followed by "a ".

**8. [Low] "Give it a shelf first" is a dead end on a one-book shelf**
- Repro: new library, one book on Works in Progress. Right-click the shelf name, or press Ctrl+' with no Canon. The offer says "If this book is its own story, give it a shelf first", with no Move button.
- Cause: app.js:16618 offers Move only when `shelf.bookIds.length > 1`, and the shelf's right-click calls `canonOffer(shelf)` with no book (app.js:1017).
- Impact: a first-time writer hits this on their very first book.

**9. [Low] The notebook hint never reaches a writer with no reader**
- The line "World-building notes? Right-click + ... New Notebook" (app.js:17215) shows only when a reader is installed and the Canon is empty. With no reader, `canonHome` returns the setup page first (app.js:17207). The ⌘K "New Notebook" entry works.

**10. [Low] RENAME.md is stale**
- It says the update check and the error dialog still point at hughhowey/neo. After e812fcf, main.js:3434 and main.js:3592 point at bfdcampos/neo-canon.
- That repository does not exist until the owner renames it, so the update check will get a 404 until then. Not driven.

**11. [Low] README opens with an unsourced claim about George R.R. Martin**
- README.md:11 says he "famously flipped the sex of a horse". I could not confirm that. Soften it or drop the name.
- Image paths all exist, and the Development steps match package.json.

**12. [Low] AGENTS.md Canon section is accurate but incomplete**
- Verified accurate: file roles; the `canon:*` IPC names; `canon-<slug>-<shelfId>/` with `canon.json`, `not-slips.json` and `entries/` (also `set-aside/`); the `utilityProcess` fork; the `CANON_ON` gating.
- Not mentioned: `set-aside/`, `userData/canon-cache`, the 90 s quiet threshold, and the `NEO_CANON_FAKE`, `NEO_CANON_READERS` and `NEO_CANON_QUIET_MS` test hooks.

**13. [Info] `NEO_CANON_READERS` pointing at a missing file breaks Open**
- Repro: set the variable to a nonexistent path; `canon:open` throws ENOENT (main.js:2449) and the Canon tab is blank with "Something hiccuped".
- Dev-only: packaged builds ignore the variable. I tripped on it in my own harness.

## Fresh-install journey (real input events, empty library)

Everything below used real mouse and key events (`sendInputEvent`) in an empty library.

1. First launch showed the welcome dialog. I went through it, then New Book (the + tile). I wrote the title and two paragraphs: "Pip, a chestnut mare, stood..." and "Hana waited... Pip shook her mane...".
2. Finding Canon. ⌘K "canon" lists "Keep a Canon for This Shelf..." first (j05). Ctrl+' with no Canon gives an offer dialog (j06). Right-clicking the shelf name shows "Keep a Canon for 'Works in Progress'" (j07). The pause checkbox is hidden before Keep and visible after (verified).
3. Setup page (j08). It says "Canon needs a reader" and gives one gold button, "Download and Read the Shelf", with the size. The offline press gave "NEO can't reach the download right now ... everything else keeps working" and Try Again, and typing still worked. The page is clear. The gap is the time estimate (finding 3). Quick reader and Licence sit under Other choices.
4. "+ New Entry" -> name "Pip" -> Enter opened the kind menu and waited (F2 fix OK) -> Creature -> "+ Add a fact" -> "Sex: female". The entry shows "You, in Canon". Mentioned in lists both passages (j12).
5. Typed " Pip shook his head." and pressed Ctrl+'. The pass started within 4 s, with no pause from the modifier key (F3 OK). Pane: "Without Canon's reader, only the plainest slips are checked", plus a dotted mark under "his".
6. Hover opened the popover: "Pip is female. Established in your Canon." with three buttons on one row: "his -> her", "Pip is now male...", "Not a slip" (j15). It closed 0.5 s after the pointer left and closed on a key (F6 OK).
7. The popover button changed "his" to "her" with the toast "Changed. Ctrl+Z brings it back." One Ctrl+Z restored it.
8. Extra checks on Apply. With four "Pip shook his head." paragraphs, one in italics, the right occurrence changed each time, the `<i>` was preserved, and each Apply undid separately.
9. ⌘K "map" -> World Map shows Pip, 2D/3D, Find, legend (j20). The first Esc in Find clears it and keeps the map; the second closes the map and stays in the book (F11 OK). "In this chapter" lists CREATURES / Pip (j18b). ⌘K "notebook" makes a notebook with the title selected (F16 OK). The shelf shows the cloth tile with a red ribbon (j22).
10. No marks or UI decoration reached the chapter HTML (checked after the pass and after Apply).

## Fixed items re-tested (no regression, no fake fix)

- Re-driven here: F2, F3 (window side), F6, F11, F15 (⌘K), F16, F21 (menu), F22 (one row at 360 px), UX 1, 2, 3 (⌘K commands, but see finding 4), 4, 5, 6, 8, 9, 15, 19, 21, 24, 25.
- Seen in the e2e screenshots (shots/e2e): F5 light map, F9 and F10 summary strings, F12 (via the passing e2e), F13 (e2e creates a folder `conflict.md`), UX 5/6 "What others say - Plans", Review Changes with the snapshot sentence (UX 10).
- Not re-driven: F8 and F19 beyond the e2e, F14/F20 beyond unit tests.
- Gate unit tests (`canon-gates.test.js`, 15 tests) pass. My extra fake-reader attacks:
  - Anna/Berit/Cora, with an always-yes `ask` through the real `localReader.judge`: only the correct pair was checked; Cora stayed unverified.
  - A misspelt place value (Kelsharow): unverified.
  - A dialogue lie first in reading order, with a plan line "in foal": the dialogue fact stayed unchecked and the plan fact was not checked.
  - The author's `yesReader`, which skips the double question, does check a three-name relation: Anna sibling Cora verified (qa/adv.test.js T1). That is a test-double artefact, since the real gate is double-asked.
- Still open as documented: F3/F18 engine TODO, F17, F23, F24, UX 7/12/13/14.

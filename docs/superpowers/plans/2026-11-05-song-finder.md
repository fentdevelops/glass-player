# First-launch song finder: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a fresh install, find the songs in Music and Downloads, show "Here's what we found" with likely songs ticked and junk unticked, add what the person keeps, then keep watching those folders for new songs.

**Architecture:** A pure scorer and a folder walker under `scan/`, run from the main process in batches so nothing blocks. The renderer shows a glass window from `renderer/firstrun.js`, reached from the intro on first launch and from Settings afterwards. Scores never touch the audio or the internet.

**Tech Stack:** Electron main process, the existing `readMeta` in `main.js`, recursive `fs.watch`, `renderer/search.js` for forgiving search, `node:test`, `scripts/ui-test.js`.

**Spec:** `docs/superpowers/specs/2026-11-05-first-launch-scan-design.md`

## Global Constraints

- Only reads. Never moves, renames, tags, copies or deletes any file.
- Scans the OS Music and Downloads folders only (`app.getPath('music')`, `app.getPath('downloads')`). No audio decoding, no online lookup. Video files aren't offered.
- Every file gets a score. At or above the threshold it starts ticked. Below it, it still appears, unticked, in its own group with a short plain reason.
- Length: under 45 s strongly against, 45 to 90 s mildly against, over 30 minutes against. Title plus artist for, album for, no tags mildly against. Names and folders with sfx, sound effect, notification, ringtone, alarm, recording, voice memo, WhatsApp Audio, PTT, kick, snare, hat, loop, one-shot, sample, stem or bpm against. Files inside game or app folders against. Mono at a low sample rate against. Several tagged files sharing an album in a folder for.
- Ignore `.crdownload`, `.part`, `.tmp`, `.download`. A watched file is only scored after its size hasn't changed for about 2 s.
- Only a fresh install with an empty library sees the window automatically. People with a library get it from Settings → Library → **Find songs on this PC**, which also turns on watching, and a toggle switches it off.
- One button: **Add N songs**. Unticked files are never offered again unless the person asks.
- **Select all**, **Select none**, and search through `renderer/search.js`. Search filters the list and leaves ticks alone.
- UI: same glass, motion and plain language as the rest of the app, no emojis. Never freezes.
- Tests only touch scratch folders. The owner's real folders are read only by the dry run in Task 1, which prints counts and reasons only, never file names.
- Nothing is published until the owner tries it in Glassy Dev and says it's good.

## Review Focus

- **A huge Downloads folder** (tens of thousands of files, or a nested `node_modules`): the window opens at once, the count climbs, and the app stays smooth. Pinned in Task 2.
- **A missing, empty or redirected folder** (for example Music moved to OneDrive, or no Music folder): it scans what exists and shows a kind empty state with Add a folder. Pinned in Task 2.
- **A corrupt, locked or unreadable file:** it's scored from its name alone, or left out, and the scan continues. Pinned in Task 2.
- **Non-English names and very long paths:** they appear correctly and search finds them. Pinned in Task 3.
- **The same file reached twice, or a folder link that loops:** each real file appears once and the walk ends. Pinned in Task 1.

---

### Task 1: Scoring, walking and the read-only dry run

**Files:**
- Create: `scan/score.js`, `scan/walk.js`, `scripts/scan-dry-run.js`, `tests/scan/score.test.js`, `tests/scan/walk.test.js`
- Modify: `package.json` (add `scan/**/*` to `build.files`, add `"test": "node --test tests/"` if it isn't there yet)

**Interfaces:**
- `scoreFile({ path, duration, title, artist, album, channels, sampleRate, albumNeighbours }) -> { score: number, ticked: boolean, reason: string | null }`
- `THRESHOLD: number`, exported from `score.js`
- `walk(roots: string[], { onBatch(paths: string[]), batchSize = 200, signal }) -> Promise<{ scanned: number }>`. Audio extensions only, same list as `main.js`'s media filter minus video. Skips partial-download extensions and tracks real paths so links can't loop.

- [ ] **Step 1: Write the failing tests:**

```js
// score
assert(!scoreFile({ path: 'C:/x/ding.ogg', duration: 9 }).ticked);
assert.match(scoreFile({ path: 'C:/x/ding.ogg', duration: 9 }).reason, /9 seconds/);
assert(scoreFile({ path: 'C:/m/a.mp3', duration: 200, title: 'T', artist: 'A', album: 'B' }).ticked);
assert(scoreFile({ path: 'C:/m/untagged song.mp3', duration: 210 }).ticked);    // real songs often have no tags
assert.match(scoreFile({ path: 'C:/d/podcast.mp3', duration: 3700 }).reason, /over 30 minutes/);
assert.match(scoreFile({ path: 'C:/d/WhatsApp Audio 2026.ogg', duration: 120, channels: 1, sampleRate: 16000 }).reason, /voice recording/);
assert.match(scoreFile({ path: 'C:/d/Packs/808 kick loop 140bpm.wav', duration: 8 }).reason, /sample pack/);
assert(scoreFile({ path: 'C:/m/Album/x.mp3', duration: 80, title: 'Intro', artist: 'A', album: 'B', albumNeighbours: 9 }).ticked);  // a short album intro stays
assert(!scoreFile({ path: 'C:/Downloads/MyGame/Audio/music1.ogg', duration: 95 }).ticked);    // game folder
// a song whose name merely contains a junk word isn't junk when it's tagged and full length
assert(scoreFile({ path: 'C:/m/Hat Trick.mp3', duration: 190, title: 'Hat Trick', artist: 'A' }).ticked);
// walk, on a scratch folder
test('only audio files are returned, and .crdownload, .part, .tmp and .download are skipped');
test('a directory link that loops ends the walk and each real file appears once');
test('an unreadable directory is skipped and the walk continues');
test('batches are at most batchSize, and an aborted signal stops the walk');
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `npm.cmd test`. Expected: modules not found.

- [ ] **Step 3: Write `score.js` and `walk.js`.** Point values are the builder's first guess.

- [ ] **Step 4: Run them and confirm they pass.**

- [ ] **Step 5: Write `scripts/scan-dry-run.js`,** run with Electron so it can reuse the app's tag reader. It takes folders as arguments and prints only totals, how many are ticked or unticked, a score histogram, how many hit each reason, and the extensions seen. It prints no file or folder names, writes nothing, and opens files read-only.

- [ ] **Step 6: Commit.** The controller, who has the owner's permission, runs the dry run on the real folders and tunes the points. The implementer must not run it there; use scratch folders only.

### Task 2: The scan service in the main process

**Files:**
- Create: `scan/service.js`, `tests/scan/service.test.js`
- Modify: `main.js`, `preload.js`

**Interfaces:**
- Consumes: `scoreFile`, `walk`, `readMeta`
- Produces: `glass.scan = { start(), stop(), onProgress(cb), add(paths, skipped), findFromSettings(), status() }`.
- Progress messages: `{ scanned, found, done, items: [{ path, title, artist, album, duration, ticked, reason, folder, url }] }`, at most 10 a second.
- `scan-state.json` in userData: `{ seen: { [path]: true }, skipped: { [path]: true }, watching: boolean, ran: boolean }`.

- [ ] **Step 1: Write the failing tests** on scratch folders with a stub `readMeta`:

```js
test('progress arrives in batches, and the event loop stays free during 5000 files');   // a timer keeps firing within 200 ms
test('a file whose metadata read throws is still scored from its name, and the scan finishes');
test('a missing root is skipped; two missing roots finish with found 0');
test('albumNeighbours counts tagged files sharing an album in one folder');
test('a path in skipped or seen is not offered again');
test('add() records the skipped paths, marks ran and turns watching on');
test('stop() ends the scan and no more progress is sent');
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass.** Validate IPC senders and arguments, like the app's other handlers. `add` only accepts paths the scan itself offered.

- [ ] **Step 3: Commit.**

### Task 3: "Here's what we found"

**Files:**
- Create: `renderer/firstrun.js`, `tests/ui/firstrun.js`
- Modify: `renderer/intro.js` (`Intro.finderStep`, run after the feature screens and any account step, before entering the app), `renderer/settings.js` (Library section: Find songs on this PC, and a watching toggle), `renderer/index.html`, `renderer/styles.css`

**Interfaces:**
- Consumes: `glass.scan.*`, `Search` from `renderer/search.js`, `addTracks` and `libChanged` from `app.js`
- Produces: `FirstRun.open({ auto }) -> Promise<void>`, which resolves when closed

- [ ] **Step 1: Write the failing test,** with a scratch Music and Downloads through test environment variables (`GLASS_SCAN_ROOTS`, honoured only with `GLASS_SHOT`):

```js
// fresh install: the window opens after the intro, the count climbs, and the app stays responsive
// tagged albums group by album and loose files by folder; biggest groups first
// the ding.ogg row is unticked, in the "Probably not songs" group, with "9 seconds" next to it
// ticking a group ticks its songs, and one unticked song shows the group as partly ticked
// Select none, then Select all; the button reads "Add 12 songs", and with none ticked it can't be pressed
// searching 'beetles' finds 'Beatles' and changing the search keeps the ticks; a Japanese file name shows and is found
// Add closes the window, those songs are in the library, unticked ones aren't, and they aren't offered next time
// a library that already has songs: no automatic window; Settings' button opens it and hides what's already in the library
// no songs found: a kind empty state with Add a folder
// closing without adding leaves the library empty and nothing breaks
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass.**

- [ ] **Step 3: Read screenshots at 1240x800 and 900x600,** including a list of 2000 rows, which must use a virtual or collapsed list so it stays smooth. Check them against the rest of the app's glass and motion.

- [ ] **Step 4: Commit.**

### Task 4: Watching for new songs

**Files:**
- Create: `scan/watch.js`, `tests/scan/watch.test.js`
- Modify: `scan/service.js`, `main.js`, `renderer/firstrun.js`

**Interfaces:**
- `startWatching(roots, { onFile(path), settleMs = 2000 }) -> { stop() }`, using recursive `fs.watch`
- A new `scan:added` message with `{ tracks }`. The renderer adds them to the library and shows the toast "3 new songs added".

- [ ] **Step 1: Write the failing tests:**

```js
test('a .crdownload renamed to .mp3 fires once, after the size settles');
test('a file still growing does not fire until it stops');
test('a junk file below the threshold is ignored quietly');
test('startup catch-up: files that arrived while closed are scored; seen and skipped ones are not');
test('a watcher error on a missing or removed folder does not crash');
test('the toggle off stops the watcher and no more files are added');
```

- [ ] **Step 2: Run, confirm the failure, write it, run, confirm the pass.** Several files arriving together make one toast.

- [ ] **Step 3: Commit.**

# First launch: "Here's what we found" (Glass 0.2.5)

## Why
Someone who just installed Glass should have their music in it within a minute, without picking folders and without junk (notification sounds, voice notes, sample packs) cluttering the library. After that, songs they download should simply appear. It's the first impression, so it has to feel effortless and look as good as the rest of Glass.

## Goals
- On first launch, scan the user's **Music** and **Downloads** folders (Windows known folders) in the background, with a live count.
- Show a glass window, "Here's what we found", listing everything playable that was found.
- Every file gets a **song score**. Songs that pass start **ticked**. Files that don't still appear, **unticked**, in their own group with a short reason.
- Grouped drop-downs: by album when the files are tagged, otherwise by folder. A group checkbox ticks or unticks the whole group; opening it shows the single songs with their own checkboxes.
- **Select all** / **Select none**, and a **search bar** using Glass's existing forgiving search (search.js: typos, missing words, accents all still match). Search filters the list; ticking stays as it was.
- One button: **Add N songs**. Choices are remembered: unticked files are never offered again unless the user asks.
- After the first launch, Glass **keeps watching** Music and Downloads. A new file that passes the score is added by itself, with a small "3 new songs added" note. Files arriving while Glass was closed are picked up at the next start.

## Non-goals
- Listening to the audio or looking songs up online (AcoustID would reject unreleased songs, which this library is full of).
- Moving, renaming, tagging or deleting any file. Glass only reads.
- Scanning whole drives or other folders (the existing Add folder button stays for that).

## Anti-goals (a failure even if it technically works)
- The window takes long to appear, or Glass freezes while scanning thousands of files.
- Junk lands in the library without the user seeing it.
- A half-finished download gets added.
- Someone who already has a library is suddenly shown the window or gets files added they didn't ask for.

## Approaches considered
1. **Score each file on simple signals** (chosen by the user). Fast, offline, every rejection has a readable reason; weak on odd cases, which stay visible and unticked so the user decides.
2. Analyse the audio itself (music vs speech vs effects). More accurate on odd cases but decodes every file: minutes of CPU on first launch.
3. Audio fingerprint lookup online. Accurate for released music but wrongly rejects unreleased versions, needs a connection and a paid key.

## The song score (my call, tunable after a read-only dry run on the user's real folders)
Each signal adds or subtracts points; at or above the threshold the file is ticked. Reasons are the strongest negative signals, in plain words.
- **Length:** under 45 s strongly against ("9 seconds"); 45–90 s mildly against; over 30 min against ("over 30 minutes, likely a podcast or audiobook").
- **Tags:** title + artist for; album for; none at all mildly against.
- **Names and folders:** words like sfx, sound effect, notification, ringtone, alarm, recording, voice memo, WhatsApp Audio, PTT, kick, snare, hat, loop, one-shot, sample, stem, bpm against ("looks like a sound effect" / "voice recording" / "sample pack"); files inside game or app folders against.
- **Sound:** mono at a low sample rate against ("voice recording").
- **Neighbours:** several tagged files with the same album in one folder for (an album).
- Video files are not offered in this window (they stay addable by hand).

## How it works
- **Main process** (main.js): walk both folders with the existing media-file filter, read tags and length with the existing `readMeta` in batches, score each file, stream results to the window (`scan:progress`), never blocking the UI. Skipped paths and the "seen" list are stored in the app's user data.
- **Window** (new `renderer/firstrun.js` + styles): glass sheet, same look and motion as Settings; groups glide open; counts update live; Add closes it and the library fills in with the usual entrance animation.
- **Watching:** Node's recursive `fs.watch` on both folders (native on Windows). Ignore `.crdownload`, `.part`, `.tmp`, `.download`; wait until a file's size has stopped changing for ~2 s; score it; add if it passes, otherwise ignore quietly. At startup, compare against the saved list to catch files that arrived while Glass was closed.
- **Who sees it:** only a fresh install with an empty library gets the window automatically, and watching is on for them once they press Add. People who already have a library don't get the window; they can run it from Settings → Library → **Find songs on this PC**, which also turns on watching (a toggle there switches it off).

## Testing
- Off-screen with scratch folders of test files (short ogg effects, mono voice-like recordings, tagged album folders, an untagged loose mp3, a podcast-length file, a fake `.crdownload` that later becomes an mp3).
- A dry run of the scoring on the user's real Music and Downloads folders, read-only, reporting counts and reasons only, before tuning.

## Left to the builder
Exact point values and threshold (tuned on the dry run), the group sort order, the batch size, and the wording of reasons.

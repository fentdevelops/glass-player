# Glass Player: what's been built

A liquid-glass music and video player for Windows (Electron). This file lists everything built so far,
how to use it, where it lives in the code, and what's still waiting on you.

**Current version:** 0.2.2 · **Code:** https://github.com/pxlarized2/glass-player (public) · **Releases:** the repo's Releases page. Installed copies update themselves from there.

---

## Waiting on you

| What | Why | How |
|---|---|---|
| Check the window corners | The rounded-corner fix was checked off-screen only | Look at the four corners of the installed Glass on your screen |

---

## Earlier versions (before this session)

- **v1–v2:** player with Queue, Albums and Playlists, a ••• menu, Edit info (MP3 tag writing + file rename), playlists with images, moving colour ambience, bass-reactive artwork.
- **v3:** Favorites; Edit info → **Find online** (Apple Music + Deezer, no keys).
- **v4:** Windows acrylic window, Apple-style grey/white glass, fast virtualised lists (tested with 10k songs), Library grouping, sorting and layouts, A–Z rail, wide mode, on-disk metadata and cover cache.
- **v5:** typo-tolerant search, Library filters with chips, Local/Spotify switch (browse + control Spotify on your devices).

---

## This session

### Lyrics
- **Lyrics panel:** the speech-bubble button in the dock, or **Y**.
- **Where lyrics come from, in order:** a `.lrc`/`.txt` next to the song → lyrics inside the song's tags → a match you picked before → **LRCLIB** online (free, synced when available).
- **Synced lyrics** follow the song: the sung line glides to the middle, others fade back, gaps show pulsing dots. Click a line to jump there. Scrolling by hand pauses following for about 4 s.
- **Search lyrics** in the panel, searching as you type: LRCLIB results marked Synced or Plain, with a warning when a result's length doesn't match the song. A **Search on Genius ↗** row opens Genius in your browser. Genius doesn't allow apps to fetch lyrics, so its text isn't pulled in.
- **••• menu:** Save as `.lrc` next to the song, Wrong lyrics → remove, Look again.
- **Works for Spotify songs too**, following Spotify's playback position. Switching between Local and Spotify no longer leaves stale lyrics on screen.
- **Remembers results** (a "not found" is retried after a week) and pre-loads the next song's lyrics while the panel is open.
- **Opening lyrics** slides the cover and title aside while the lyrics glide in. Closing reverses it.

### Library and albums
- **Album groups need 2+ songs.** One-song albums and untagged songs gather under the artist's name ("Singles") when that artist has 2+ of them. Anything left goes to **Unknown album**.
- **Groups are ordered** from most songs to fewest, with unknowns last.
- **Album headers** have a gap above them, bigger art and a bigger name. The album's songs are indented on a thin rail with smaller thumbnails.
- **Album drop-down animation:** songs ghost in from under the header (faded, blurred, staggered) and fold back up on close, and the rest of the list glides.
- **Drag a song onto another song** to make a new album, with the name box ready and a cover made from both songs' art. Drop a song on an album header to add it to that album.
- **Edit album** (pencil on hover, album page, or right-click the header): rename it (applies to every song) and change its cover.
- **Edit info** has artist and album pickers that show existing ones with their artwork, biggest first.
- **The list stays where you scroll it** when a new song starts.

### Tabs
- **Queue · Search · Library** (same in Spotify mode).
- **Search, empty box:** recommendations.
  - **Local:** Jump back in, Made for you, Most played, Recently added. A **Browse** row (Albums · Artists · All songs · Folders) opens the full grouped view, and the shuffle button gives new picks.
  - **Spotify:** your recently played and top songs.
- **Search, typing:** matching Artists and Albums first, then Songs. Typing `#tagname` searches by tag.
- **Library:** playlists, plus Favorites (local) and Liked Songs (Spotify).

### Artist pages
- **Header:** photo, a short description, a bio from **Wikipedia** (with "Read more" link), songs, albums, total time, plays and genres.
- **Sections:** Most played, Albums (each opens that album), All songs.
- **Spotify artists:** followers, popularity, genres, Popular songs, Albums and singles. Spotify's API has no bios or real play counts.
- **Plays** are counted by Glass: a play counts after 30 s, or half the song if it's shorter.
- **Under the playing song**, the **artist** and **album** names are links to their pages, in both Local and Spotify.

### Cover art
- **Change cover** menu (Edit info, playlists, new and edited albums):
  - **Choose an image…**, then **Adjust**: drag to move, scroll or slider to zoom, **Fit whole image** (blurred fill instead of black bars) or **Fill square**.
  - **Use art from another song…**: every artwork in your library grouped by picture, with how many songs use it. Open one to see those songs, then tick as many songs as you like to give it to them all at once.
  - **Adjust this cover…**
- **Cover art never tilts.** Hovers only expand it slightly.
- **The big cover drifts** up to ~5 px toward your mouse, translate only.

### Quick edits (Settings → Glass → Quick edits, on by default)
- **Right-click the big cover** to change it.
- **Double-click the title, artist or album** under the cover to rename it in place. Enter saves, Esc cancels.

### Tags
- **Your own tags** with a name, an emoji (grid, or type any emoji with Win + .) and one of 10 colours.
- **Tag songs** from the song's ••• menu → Tags, from Edit info, or right-click an album header → "Tag all N songs".
- **Chips on song rows**, a **Tags** section in the Filter menu (coloured filter chips), and **Manage tags** to edit, delete, or show a tag's songs.

### Quality badges
- **Every song gets a badge:**
  - **Hi-Res:** lossless, over 16-bit or 48 kHz
  - **CD:** lossless at CD quality
  - **HQ / SQ / LQ:** lossy files, judged by bitrate, with AAC and Opus counted fairly against MP3
- **The playing song** shows a detail line like `M4A · 251 kbps · HQ`.
- **A Quality section** in the Filter menu.

### Playback
- **Instant skips:** the next song is chosen ahead (even on shuffle) and pre-loaded: audio, tags, full cover and lyrics. Measured on your files, the cover appears 2–3 ms after a skip (was 8–31 ms).
- **Autoplay** (like Spotify): when the queue is nearly done, it adds similar songs (same artist, album, genre, folder; at most 4 per artist), shown under an "Autoplay" label. It can be turned off in Settings.
- **Clicking the song that's playing** restarts it (or pauses it, if you choose that in Settings).
- **Sleep timer:** 15 min, 30 min, 1 hr, or end of song.

### Sound (Settings → Sound)
- **Bass boost** (0–12 dB) and **Treble**.
- **5-band EQ** with presets: Flat, Bass, Treble, Vocal, Rock, Pop, Electronic, Acoustic, Late night, Custom.
- **Reverb** (Room, Plate or Hall), **Even out volume**, **Mono**, and **Reset sound**.
- **Headroom:** volume is lowered a little as you boost, so heavy bass doesn't distort.
- These effects apply to local songs only. Spotify audio plays through Spotify's own protected player.

### Playback settings (Settings → Playback)
- **Autoplay**
- **Clicking the playing song:** Restart or Pause
- **Fade in and out:** 0–8 s, at the start and end of every song
- **Fade on play and pause**
- **Speed** 0.75×–2×, and **Keep pitch**
- **Arrow-key skip** 5/10/15 s (Shift + arrow always skips 30 s)
- **Sleep timer**

### Look and feel
- **Liquid glass:** the side panel, dock, artwork frame, lyrics panel and start card are thick frosted glass with a bright rim. Each bends the background near its edges, frosts the middle and keeps the rim crisp.
- **Artwork wallpaper:** the playing song's cover fills the window behind everything and crossfades between songs.
- **Settings → Glass:**
  - **Style:** Liquid, or Frosted (lighter on older PCs)
  - **Background:** Artwork or Colours
  - **Glow and darkness** sliders
  - **Quick edits**
- **Resizable side panel:** drag its left edge (sideways only); double-click the edge to reset.
- **Smooth hovers:** every hover glides in and back out (song rows used to snap).

### Spotify
- **Playing inside Glass** (needs Premium, VMP signing and a reconnect): Glass registers as a Spotify device called **Glass Player**. When nothing else is playing, songs play right in Glass with no Spotify app open. Other devices still work and you can switch between them.
- **Spotify search** shows recommendations when the box is empty.
- **Settings → Spotify** shows whether in-app playback is ready, with a **Reconnect** button.

### Updates
- **Bottom-right popup** that stays until you act on it:
  - **Downloading**, with a progress bar
  - **Ready:** **Restart to update**. "Later" shrinks it to a small pill that stays.
  - **Portable exe:** **Download**, since a portable exe can't replace itself
- **Settings → Updates** shows your version, with a **Check now** button.
- Updates come from the public GitHub repo's Releases (see "Public repo and updates" below for how a release is made).

---

## Latest additions

### Gapless playback engine
- **Two players take turns.** While a song plays, the next one loads on a second, hidden player. When the song ends, the next one is spliced in sample by sample, so albums play with **no gap and no click**.
- **Skips are instant** when the next song is already loaded, with a short 180 ms fade instead of a hard cut.
- **Settings → Playback → Between songs:** **Gapless** (default) or **Crossfade 3 s / 6 s / 10 s**. Songs from the same album always stay gapless, even with crossfade on.
- **Fade in and out** (per song) switches off while crossfading, and doesn't break up an album that flows song to song.
- **Video to video:** the new picture dissolves in over the old one instead of flashing black.
- **Everything else keeps working on top of it:** the Sound chain (EQ, reverb, fades), speed and pitch, shuffle (the pre-chosen next song is the one that loads), repeat one, Autoplay, sleep timer ("end of song" now stops cleanly at the end), and renaming or retagging the playing song (it carries on from the same spot).
- **Tested** with 34 engine scenarios (0 clicks), in-app tests and the packaged exe.

### Click through from the playing song
- **The song title** (under the big cover and in the player bottom left) takes you to where the music is playing from: the playlist, album, artist page, Favorites or search you started it from. With no source (opened files) it goes to the Queue. Hover to see "Playing from …".
- **Every artist is its own link.** "Lil Uzi Vert x ridgeclub" shows two links; ridgeclub opens ridgeclub's page.
- **Artist pages include songs they're featured on**, not only their own.
- **In Spotify mode** the same links use Spotify's info: the title opens the playlist, album, artist or Liked Songs it's playing from, and each artist opens their Spotify page.
- **Double-click** still renames the title, artist or album (Quick edits), and doesn't navigate.

### Fits the screen
- **The side panel grows with the window** (370 px on a laptop-size window, up to 680 px on big and ultrawide screens), and the queue shows as many songs as fit: 7 rows at 800 px tall, 18 at 1440, 26 on a portrait screen.
- **A wide panel gets an album column**, lined up from row to row.
- **The cover and the title grow too** (cover up to 760 px; it was capped at 420).

### Zoom
- **Ctrl + (or Ctrl =), Ctrl −, Ctrl 0**, and the numpad + / − keys all work. Before, only zooming out did, because Electron's built-in zoom-in key needed Shift.
- **Sizes:** 50%, 67%, 75%, 80%, 90%, 100%, 110%, 125%, 150%, 175%, 200%.
- **A liquid glass pill** appears at the top showing the new size, with − and + buttons. Click the percentage to go back to 100%. It glides away about 2 s after the last change, or stays while you hover it.
- **Remembered:** the app opens at the size you left it, without showing the pill.

### Window edge and seek bar
- **The whole window has the glass rim** the panels have: a steady bright edge all the way round, brightest top left, with a glint bottom right, following Windows 11's rounded corners. It fades away when maximized or fullscreen.
- **The seek knob stays joined to the line.** The filled line now ends exactly under the knob's centre, so when the knob grows on hover it never floats off the end. Before, it sat up to 7 px past the end of the line. The volume and Settings sliders got the same fix.

### Smoother panel and lyrics
- **The expand / shrink button** (side panel, top right) was laggy. The liquid glass re-made its refraction picture on every frame of the slide: 34–40 times, about 45 fps with hitches up to 67 ms. Now a panel wears plain frosted glass while it changes size and gets its refraction back once it stops: a steady 60 fps. Window resizing and dragging the panel edge benefit the same way.
- **Lyrics close the way they open:** same speed, at the same time. Before, the panel slid out first and the cover waited about 0.34 s before moving back.
- **Lyrics glide to the sung line** on a soft spring instead of jumping: they ease in and out, and a new line mid-glide just bends the path. In testing: never more than 3 px per frame.
- **Glass maps fit exactly:** maps were sized from a panel's on-screen size, so a panel caught mid-animation or pulsing to the bass could get a slightly wrong one. They now use the panel's real size.

### App icon, installer and Start menu
- **New app icon:** a liquid-glass tile in the app's colours, with a frosted glass lens and a white play mark. It stays readable down to 16 px. Source: `build/icon.svg`, rendered to `build/icon.png`.
- **Installer:** `dist-deck/Glass Player Setup 0.2.0.exe` installs for your account (no admin) into `%LOCALAPPDATA%\Programs\Glass Player`. It adds Start menu and desktop shortcuts, so typing "Glass" in Windows search finds it, and an entry in Settings → Apps so it can be uninstalled.

### Albums, finding the playing song, video button
- **Albums start closed** in grouped lists. Click one to open it; it stays open until you close Glass.
- **The song title** (dock or under the cover) goes back to where the song is playing from. If that's a grouped list, it opens the song's album, glides the song to the middle and gives it a soft glow that fades. The **album** and **artist** links do the same on their pages.
- **Fullscreen button on videos:** a small frosted-glass button in the video's bottom-right corner. It appears while the mouse moves over the video and fades after a couple of seconds of stillness. In fullscreen it becomes "exit fullscreen".
- **Why some .mp3 files play video:** 22 of the 924 .mp3 files in the library are really MP4 music videos with an .mp3 name (common with YouTube downloads), so Glass plays what's inside them. They also have no MP3 tags, hence "Unknown artist".

### Spotify fixes
- **Media keys and Windows' media controls follow the source on screen.** In Spotify mode they used to drive the local player as well, which skipped twice and paused Spotify whenever a local song started.
- **No more skip loops inside Glass.** Glass only becomes a Spotify device ("Glass Player") once the build is signed for Spotify. If Spotify still fails twice within 30 s, Glass stops being a device, moves playback to your other device, and says so once, instead of Spotify skipping through the whole queue.
- **Settings → Spotify** shows exactly what's missing for playing inside Glass: a Reconnect button for the playback permission, and the one-time castlabs sign-up command, with a Copy button.
- **A small local log**, `spotify-log.txt` in Glass's data folder, records what Glass asked Spotify to do and what changed (song, play/pause, device). It holds no passwords or tokens, and helps trace any skip that's left.

### Playing Spotify without the Spotify app: Glass sets itself up
- **A setup window**, "Play Spotify inside Glass", opens by itself the first time Spotify mode is used without in-app playback (once per launch). It's also in Settings → Spotify → **Set up**. Three steps:
  1. **Spotify permission:** opens Spotify's page in your browser; click Agree.
  2. **castlabs account:** Glass gets castlabs' free signing tool ready, installing Python and `castlabs-evs` if they're missing. It then creates the account from the form (or logs in with "I have one"); castlabs emails a code, which you type into Glass.
  3. **Sign and restart:** Glass signs its own installed copy (Widevine/VMP, which Spotify requires), marks it signed and restarts. Spotify then plays inside Glass with no Spotify app.
- **Passwords** go to castlabs' tool privately (over stdin, never on a command line), and Glass doesn't store them.
- **Fields check themselves as you type:** red with a plain message when something won't work (email, names, account name, password length, the code), a soft green edge when it's fine. castlabs' answers land on the field they're about: "That account name is taken", "That code isn't right", "Wrong account name or password", castlabs' own password rules.
- **Show / hide password** with the eye button.
- **The account name is filled in for you:** your Spotify name, or "glassy-firstname-1234". If it's taken, Glass picks another (your name plus a number) and carries on. A name that's already yours and signed in counts as done.
- **Real progress:** installs, sign-up and signing show a 0–100% bar with the tool's own lines underneath.
- **Builds sign themselves** once the account exists. Signing now runs as electron-builder's "after sign" step; it used to run before the exe got its icon and version info, which broke the signature.

### Settings, rebuilt
- **Order:** Glass, Sound, Playback, Spotify, Updates, What's new. The sheet is darker with a darker, blurred backdrop, and its sections glide in.
- **Glass on top:** big Glow and Darkness sliders with their % shown, and a **Glass colour** palette (9 colours, none, or any colour from a picker) that tints every glass panel and the dark layer behind them.
- **Equalizer curve** instead of presets: five points you drag on a smooth, glowing curve (-12 to +12 dB). Double-click a point to reset it.
- **Removed:** the sleep timer, the arrow-key skip setting (arrows skip 5 s, Shift 30 s), the Frosted style (always liquid now) and the Reload library button (Spotify's library refreshes itself when you come back after 10 minutes, and every half hour).
- **What's new** at the bottom: the latest changes, each with its own picture.
- **Speed** moved to the player: a **1×** button next to Lyrics that shows the current speed and opens the speeds (0.5× to 2×, with Keep pitch).

### Undo
- **Ctrl+Z** undoes, **Ctrl+Shift+Z** (or Ctrl+Y) redoes: queue changes, switching songs (back to the same spot), favorites, playlists, song info, tags, album covers, renaming a file (renamed back) and removing songs from the library. A glass pill at the top says what was undone. Songs moving on by themselves don't count.

### Playing a song from search
- **Albums, playlists, Favorites and folders** play in their order.
- **A song picked anywhere else** (search, recommendations, All songs, an artist) plays first, followed by a random queue from your whole library.

### Spotify feels instant
- **The song you pick shows at once** (cover, title, colours) and the music follows. Spotify's slightly late reports no longer flick the screen back to the old song.

### More lyrics sources
- **Kugou and NetEase Cloud Music** are asked alongside LRCLIB; the best synced match wins (same title, closest length), and credit lines are stripped. The lyrics search box lists all three, synced first. QQ Music only answers requests that claim to come from its own site, so it's not used. Genius has no timed lyrics, so it stays a browser link.

### Window corners
- **The whole page is clipped** to Windows 11's 8 px rounded corners, and rounded corners are asked for explicitly. With Transparency effects off, the window uses a solid dark background instead of acrylic (which was solid grey anyway).

### Spotify's 2026 API
- **Liked songs** use Spotify's new library endpoint (`/me/library` with song links). The old one answered "403 Forbidden", which left hearts empty and filled the log. If it's refused, Glass stops asking for that session.
- **Artist pages:** Spotify removed "top tracks", so the "Popular" songs now come from a search for the artist.
- **Future builds** are signed automatically once the account exists (`scripts/vmp-sign.js`).
- **Needs** Spotify Premium (you have it) and the installed Glass, not the portable exe.

### Background picture and blur
- **Settings → Glass → Background:** Artwork, Colours, or **Your image**. Your image keeps your picture behind the glass whatever plays. It's stored at full size (up to 3840 px) and works best landscape 16:9 at high resolution, like 3840 × 2160 or 1920 × 1080. The row under it shows your picture's size and says if a sharper or 16:9 one would look better.
- **Background blur** slider (0–40 px) for the artwork or your picture. It was fixed at 3 px.
- **Softer window edge:** the rim around the window is thinner (1 px) with a gentler glow.

### Search box and scrollbars
- **Each tab keeps its own search.** Typing in Search no longer carries over to Library or the Queue. Search and Library each remember their own text (separately for Local and Spotify), and it's back when you return to the tab.
- **The Queue has no search box.** It folds away when you open the Queue and unfolds in the other tabs. Ctrl+F from the Queue jumps to Search with the box ready.
- **Scrollbars are a white floating pill** (Settings, Edit info and every other sheet): no track, no arrows, clear of the edges.

### Spotify video
- **Cover and icon stay the album art.** When a song is switched to its music video in Spotify, Spotify can send Glass a wide video frame as the song's picture. Glass now keeps the square album cover for the big art and the dock icon, using the last real cover of that song or album, or fetching the album's cover.
- **Audio / Video switch** under the song, shown when a song comes with a video picture. **Video** slides the frame from a square into 16:9 (wider and shorter, the picture re-cropping as it goes), **Audio** slides it back. Glass remembers your choice.
- **Knows by itself:** Glass compares the playing song's picture with its album's real cover, fetched once per album. Any other picture, wide or square, is the video's picture. The song then gets the switch, and the cover frame **widens a little toward 16:9 and settles back** once, as a hint.
- **What Video shows:** the video's picture, a still frame. Spotify only plays the moving video inside its own apps: its developer API has no video stream and no video/audio switch, and its terms don't allow pairing its songs with other videos.

### Public repo and updates (0.2.1)
- **The code is public** at https://github.com/pxlarized2/glass-player, checked for passwords, keys, tokens and personal paths first (none, in any commit).
- **Glass updates itself.** It checks GitHub 8 s after it opens and every 3 hours, downloads a new version in the background, and installs it when you restart (the popup bottom right has **Restart to update**) or the next time you close Glass. The portable exe can't replace itself, so it offers the download page instead.
- **Fixed: updates never switched on.** The packaged app has no `build` section in its package.json, so Glass couldn't see where to look. It now reads the repo from `resources/app-update.yml`, which every build carries. 0.2.0 had this bug, so 0.2.0 → 0.2.1 was installed by hand; later versions arrive by themselves.
- **"Glass updated" card:** the first time a new version opens, a glass card bottom right shows what's new (up to three changes with their pictures). **All changes** opens Settings at What's new. It leaves by itself after 20 s unless you're hovering it, and shows once per version. A fresh install doesn't show it.
- **Releases are built on your PC,** so they're signed for Spotify. The GitHub Actions release workflow was removed: GitHub's servers don't have your castlabs account, so their builds would have broken Spotify inside Glass after an update.
- **The update popups sit higher,** clear of the player bar.

### Spotify inside Glass: what the log showed, and what changed (0.2.1)
- **It never actually played.** Your `spotify-log.txt` shows 45 songs sent to Glass and every one sat at 0:00; Spotify never once reported "playing" there. Glass became the active device and accepted Play, but no sound started. Earlier I took "on Glass Player" in the log as proof it worked; it wasn't.
- **Ruled out:** Widevine works in the installed, signed Glass (tested with a separate test profile: every audio format Spotify uses unlocks). Glass's content rules don't touch Spotify's player (it plays inside its own sdk.scdn.co frame). Electron doesn't block autoplay.
- **The log now shows what Spotify's player sees.** Its own console warnings and errors, how Spotify's servers answer it (licence, audio, player requests; host and path only, never tokens), when sound actually starts or pauses in Glass, and the player's own state (playing, paused, still loading).
- **Autoplay block handled:** if the browser stops the music starting by itself, Glass says "Click anywhere in Glass to start the music" and the next click starts it.
- **Stall nudge:** 3.5 s after Play, if the song is still at 0:00 on Glass, Glass unlocks audio and resumes from inside the player, and logs whether that worked.
- **Playlists Spotify hides:** since February 2026 Spotify refuses to list the songs of some playlists to apps (403). The page now says so and **Play** at the top still plays the playlist, instead of "Can't show this playlist" with a Retry that never works.
- **Search** asks for 10 results at a time (Spotify's new maximum), so the first search no longer fails once before retrying.
- **First real playback, then a drop:** with the new log, six songs played inside Glass for 13 minutes (licence, audio and player all answered fine), then at 00:51 the player lost its song mid-song, and every Play after that went to a player that no longer existed. One path could cause that without a trace: when Spotify refused the player's sign-in, Glass switched the player off for good and waited for "Reconnect" in Settings, without logging anything.
- **The player heals itself now.** If Spotify refuses its sign-in, it goes offline for 15 s, or the song drops while Spotify still names Glass as the device, Glass gets a fresh sign-in, starts a new player and carries on with the same song at the same spot (inside the same album or playlist, or the same list of songs). If you moved playback to another device yourself, it's left there. After 3 reconnects in 10 minutes it stops and waits for Play instead of looping; **Play** (or the play button) restarts a stopped player first, then plays on it. Every step is in the log.
- Checked with a stand-in for Spotify's player in an off-screen test: refused sign-in → back at 74 s on a new player; dropped song → back at 82 s; playback moved to another device → left alone; a 4th failure → stops; Play → back.
- **Two "Glass Player"s on Spotify (you found this one).** Spotify keeps listing a player until the player signs off, and Glass never signed off when it closed (quitting, an update, a reinstall). Each of those left an old "Glass Player" on your account that plays nothing. When Spotify (or its device menu) sent the music there, nothing happened. The log shows it: songs changing "on Glass Player" with nothing from Glass's own player, and two switches from one "Glass Player" to another.
  - **Glass signs off when it closes.** Closing waits for Spotify to confirm (1.5 s at most; instant without Spotify), so no new old ones are left behind. Restarting after signing for Spotify signs off first too.
  - **Old ones are hidden.** Any "Glass Player" that isn't this Glass's own is left out of the Play on lists (the Spotify button in the dock and Settings).
  - **Music sent to an old one comes back.** If Spotify plays on an old Glass Player, Glass moves it to its own player; Play and the play button do the same; and a song that drops because Spotify moved it to an old one is brought back.
  - **Only one player at a time.** Starting the player twice at once (sign-in, Play and a reconnect together) used to be able to make two; now it makes one, and a replaced player is switched off.
  - Glass can't delete an old Glass Player from Spotify's side; Spotify drops it by itself after a while. Until then the Spotify app's own device menu may still show it, and Glass pulls the music back if it's picked.
  - Checked with the stand-in in an off-screen test: three starts at once → one player; stop/start while starting → one live player; an old Glass Player on the account → hidden from Glass's lists; music sent to it → moved back, still playing; Glass closing → player signed off.

### Lyrics when the queue panel is wide (0.2.2)
- **The bug:** with the lyrics open and the queue panel dragged wider (or a small window), the cover vanished but the lyrics stayed squeezed into the right-hand column with an empty gap on the left. An older layout rule overrode the narrow layout, and the switch happened with no animation.
- **Now:** when there isn’t room for both, the lyrics fill the whole stage (top to bottom, lined up with the queue panel) and the cover sits small in their top-left corner, next to the lyrics source and buttons.
- **The switch is a water drop:** the cover shrinks as it falls into the corner, rounds into a drop, lands with a small squash and settles, while the lyrics pour out to fill the space. Widening again lifts the drop out of the corner and it swells back into the cover, with the title rising in underneath. Switches at 640 px of stage width going narrow and 680 px going wide, so it doesn’t flicker at the edge. The cover no longer drifts toward the mouse while it’s small.
- Checked off-screen at several widths and mid-animation in both directions; the normal layouts (no lyrics, lyrics side by side, empty library) measure the same as before.

### Smooth resizing (0.2.2)
- **Cards:** card grids (Library playlists, artists, albums) used to stretch wider while their rows kept the old height, so cards overlapped, then snapped into a new grid 140 ms after you stopped. Now every frame of a drag gives the rows the cards’ real height, and when a column comes or goes the cards glide from where they were to their new spots. A width sweep from 380 to 960 px and back (117 frames) found no overlap at any frame.
- **Lyrics:** the space above and below the lines came from the panel’s width, so the whole text slid up and down as you dragged. It now comes from the stage’s height, and on every size change the sung line is put back exactly where it was (plain lyrics keep their place in the text). Measured: the sung line stays within 6 px across every width, including the switch to and from the corner layout.

### Updates find you (0.2.2)
- Glass looks for a new version 8 s after it opens, every 30 minutes, and when you come back to its window after 10 minutes away. A new version downloads quietly with a small progress card, then a card says it’s ready with **Restart to update** (Later shrinks it to a pill).
- Each finished batch of work now ships as a GitHub release with these notes, so your installed Glass picks it up by itself.

---

## Under the hood

- **Electron:** castlabs Electron **44.10.1** (adds Widevine, which Spotify's in-app player needs). Version 45 only exists as an alpha there.
- **Build:**
  ```bash
  npx electron-builder --win nsis portable -c.directories.output=dist-deck
  ```
  `build.electronDist` points at the local castlabs Electron. `scripts/vmp-sign.js` signs each build with your castlabs account (it warns and continues if the account is missing).
- **Publish a new version:** raise `version` in package.json, add its notes to `renderer/notes.js` (`v: 'x.y.z'`), commit and push, then:
  ```bash
  GH_TOKEN="$(gh auth token)" npm run release
  ```
  That builds, signs and uploads the installer, the portable exe and `latest.yml` to a new GitHub release `vX.Y.Z`. Installed copies pick it up within 3 hours, or at their next start.
- **New dependencies:** `electron-updater`. The castlabs signing tool `castlabs-evs` is installed for Python (`py`).
- **Your data** (library, edits, tags, plays, settings) is stored in the app's user folder, not in your music files. The only things that write to song files are Edit info's "Also save into the MP3 file's tags" box and "Save as .lrc".

### Files

| File | What it does |
|---|---|
| `main.js` | Window, file scanning, metadata + quality, covers, lyrics lookup, artist info (Wikipedia), artwork tools, updates |
| `spotify-main.js` | Spotify sign-in, Web API, scopes, token for the in-app player, test mock |
| `preload.js` | The bridge between the window and `main.js` |
| `renderer/app.js` | Player core: library, queue, lists, menus, Edit info, albums, tabs, filters, links to where a song plays from |
| `renderer/deck.js` | Gapless engine: two players, preloading, crossfades, skips |
| `renderer/deck-worklet.js` | The audio worklet that splices songs together sample by sample |
| `renderer/lyrics.js` | Lyrics panel (local + Spotify) |
| `renderer/sound.js` | Sound effects chain (bass, EQ, reverb, leveller, mono, fades) |
| `renderer/art.js` | Cover Adjust, art from other songs, cover menu |
| `renderer/tags.js` | Tags |
| `renderer/extras.js` | Quality badges, plays, artist pages, links under the song, side-panel resize, recommendations, quick edits, cover drift |
| `renderer/liquid.js` | Liquid glass filters + artwork wallpaper (`Liquid.watch` adds small panels like the zoom pill) |
| `renderer/zoom.js` | Zoom pill (the zoom keys are handled in `main.js`) |
| `renderer/spplayer.js` | Spotify in-app player (Web Playback SDK) |
| `renderer/spotify.js` | Spotify mode (browse, queue, artist pages, recommendations) |
| `renderer/updates.js` | Update popup, and the "Glass updated" card after an update |
| `renderer/settings.js` | Settings: Sound, Playback, Spotify, Updates, Glass |
| `scripts/vmp-sign.js` | Signs builds for Widevine |
| `renderer/undo.js` | Undo / redo (Ctrl+Z, Ctrl+Shift+Z) and the "Undone" pill |
| `renderer/eqgraph.js` | The draggable, glowing equalizer curve in Settings |
| `renderer/notes.js` | What's new: each change with its version and picture |

### How changes were checked
Every change was tested in an offscreen copy of the app with a separate test profile, so your library and screen were never touched. The tests used a generated test tone, a made-up library, fake Spotify data, and a few of your real songs (read only). Lyrics were checked with made-up lines and line counts only.

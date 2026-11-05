# Glassy: what's been built

A liquid-glass music and video player for Windows and Mac (Electron). This file lists everything built so far,
how to use it, where it lives in the code, and what's still waiting on you.

**Current version:** 0.2.15 · **Code:** https://github.com/pxlarized2/glass-player (public) · **Releases:** the repo's Releases page. Installed copies update themselves from there.

---

## Waiting on you

| What | Why | How |
|---|---|---|
| Check the window corners | The rounded-corner fix was checked off-screen only | Look at the four corners of the installed Glass on your screen |

---

## 0.2.15: Glassy on Mac, and one cover for every song that shares it

### Change a cover everywhere

- **Where:** on top of Edit info, Edit album, and Adjust cover when you right-click the big cover.
- **What it shows:** how many other songs have that exact picture (same thumbnail file contents), with their names. Click it to see the whole list.
- **The switch:** "Change all N at once" puts the new cover on all of them when you save. One Ctrl+Z puts them all back. Off by default.
- It stays hidden when no other song has that picture. Covers are saved in Glassy for the other songs; only the song you are editing can write into its MP3 file.

### Covers in the media pop-up

- The system refuses pictures given as a file on disk, so the pop-up never got the cover. It now receives the picture itself.

### Mac

- **Window:** the system's own traffic-light buttons and blur behind the window, always in dark mode so white text stays readable. The gear sits top right.
- **Keys:** ⌘ instead of Ctrl for every shortcut, and the hints on screen say so.
- **Menu bar:** Quit, copy and paste in text boxes, window controls.
- **Files:** songs opened from Finder ("Open With", double-click, dropped on the Dock icon) start playing. Library and settings live in `~/Library/Application Support/Glassy`.
- **Updates:** a card says when a new version is out and opens the download page. Mac apps can only replace themselves once they're signed by an Apple developer account.
- **Build:** `.github/workflows/mac.yml` builds Apple silicon and Intel copies on GitHub's Mac machines whenever a release is published, tests the built app with `scripts/smoke.js`, then attaches the `.dmg` and `.zip` files to the release.
- **README:** download table and first-open steps for Mac.

---

## Earlier versions (before this session)

- **v1–v2:** player with Queue, Albums and Playlists, a ••• menu, Edit info (MP3 tag writing + file rename), playlists with images, moving colour ambience, bass-reactive artwork.
- **v3:** Favorites; Edit info → **Find online** (Apple Music + Deezer, no keys).
- **v4:** Windows acrylic window, Apple-style grey/white glass, fast virtualised lists (tested with 10k songs), Library grouping, sorting and layouts, A–Z rail, wide mode, on-disk metadata and cover cache.
- **v5:** typo-tolerant search, Library filters with chips.

---

## This session

### Lyrics
- **Lyrics panel:** the speech-bubble button in the dock, or **Y**.
- **Where lyrics come from, in order:** a `.lrc`/`.txt` next to the song → lyrics inside the song's tags → a match you picked before → **LRCLIB** online (free, synced when available).
- **Synced lyrics** follow the song: the sung line glides to the middle, others fade back, gaps show pulsing dots. Click a line to jump there. Scrolling by hand pauses following for about 4 s.
- **Search lyrics** in the panel, searching as you type: LRCLIB results marked Synced or Plain, with a warning when a result's length doesn't match the song. A **Search on Genius ↗** row opens Genius in your browser. Genius doesn't allow apps to fetch lyrics, so its text isn't pulled in.
- **••• menu:** Save as `.lrc` next to the song, Wrong lyrics → remove, Look again.
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
- **Queue · Search · Library**.
- **Search, empty box:** recommendations (Jump back in, Made for you, Most played, Recently added). A **Browse** row (Albums · Artists · All songs · Folders) opens the full grouped view, and the shuffle button gives new picks.
- **Search, typing:** matching Artists and Albums first, then Songs. Typing `#tagname` searches by tag.
- **Library:** playlists, plus Favorites.

### Artist pages
- **Header:** photo, a short description, a bio from **Wikipedia** (with "Read more" link), songs, albums, total time, plays and genres.
- **Sections:** Most played, Albums (each opens that album), All songs.
- **Plays** are counted by Glass: a play counts after 30 s, or half the song if it's shorter.
- **Under the playing song**, the **artist** and **album** names are links to their pages.

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
- **Your own tags** with a name and one of 10 colours.
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
- **Autoplay:** when the queue is nearly done, it adds similar songs (same artist, album, genre, folder; at most 4 per artist), shown under an "Autoplay" label.
- **Clicking the song that's playing** restarts it.
- **Sleep timer:** 15 min, 30 min, 1 hr, or end of song.

### Sound (Settings → Sound)
- **Bass boost** (0–12 dB) and **Treble**.
- **5-band EQ** with presets: Flat, Bass, Treble, Vocal, Rock, Pop, Electronic, Acoustic, Late night, Custom.
- **Reverb** (Room, Plate or Hall), **Even out volume**, **Mono**, and **Reset sound**.
- **Headroom:** volume is lowered a little as you boost, so heavy bass doesn't distort.

### Playback settings (Settings → Playback)
- **Fade in and out:** 0–8 s, at the start and end of every song
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
- Songs run straight into each other with no gap. Songs from the same album are always seamless, even with **Fade in and out** on.
- **Fade in and out** (per song) switches off while crossfading, and doesn't break up an album that flows song to song.
- **Video to video:** the new picture dissolves in over the old one instead of flashing black.
- **Everything else keeps working on top of it:** the Sound chain (EQ, reverb, fades), speed and pitch, shuffle (the pre-chosen next song is the one that loads), repeat one, Autoplay, sleep timer ("end of song" now stops cleanly at the end), and renaming or retagging the playing song (it carries on from the same spot).
- **Tested** with 34 engine scenarios (0 clicks), in-app tests and the packaged exe.

### Click through from the playing song
- **The song title** (under the big cover and in the player bottom left) takes you to where the music is playing from: the playlist, album, artist page, Favorites or search you started it from. With no source (opened files) it goes to the Queue. Hover to see "Playing from …".
- **Every artist is its own link.** "Lil Uzi Vert x ridgeclub" shows two links; ridgeclub opens ridgeclub's page.
- **Artist pages include songs they're featured on**, not only their own.
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
- **Installer:** `dist-deck/Glassy Setup x.y.z.exe` installs for your account (no admin) into `%LOCALAPPDATA%\Programs\Glass Player`. It adds Start menu and desktop shortcuts, so typing "Glass" in Windows search finds it, and an entry in Settings → Apps so it can be uninstalled.

### Albums, finding the playing song, video button
- **Albums start closed** in grouped lists. Click one to open it; it stays open until you close Glass.
- **The song title** (dock or under the cover) goes back to where the song is playing from. If that's a grouped list, it opens the song's album, glides the song to the middle and gives it a soft glow that fades. The **album** and **artist** links do the same on their pages.
- **Fullscreen button on videos:** a small frosted-glass button in the video's bottom-right corner. It appears while the mouse moves over the video and fades after a couple of seconds of stillness. In fullscreen it becomes "exit fullscreen".
- **Why some .mp3 files play video:** 22 of the 924 .mp3 files in the library are really MP4 music videos with an .mp3 name (common with YouTube downloads), so Glass plays what's inside them. They also have no MP3 tags, hence "Unknown artist".

### Settings, rebuilt
- **Order:** Glass, Sound, Playback, Updates, What's new. The sheet is darker with a darker, blurred backdrop, and its sections glide in.
- **Glass on top:** big Glow and Darkness sliders with their % shown, and a **Glass colour** palette (9 colours, none, or any colour from a picker) that tints every glass panel and the dark layer behind them.
- **Equalizer curve** instead of presets: five points you drag on a smooth, glowing curve (-12 to +12 dB). Double-click a point to reset it.
- **Removed:** the sleep timer, the arrow-key skip setting (arrows skip 5 s, Shift 30 s), the Frosted style (always liquid now) and the Reload library button.
- **What's new** at the bottom: the latest changes, each with its own picture.
- **Speed** moved to the player: a **1×** button next to Lyrics that shows the current speed and opens the speeds (0.5× to 2×, with Keep pitch).

### Undo
- **Ctrl+Z** undoes, **Ctrl+Shift+Z** (or Ctrl+Y) redoes: queue changes, switching songs (back to the same spot), favorites, playlists, song info, tags, album covers, renaming a file (renamed back) and removing songs from the library. A glass pill at the top says what was undone. Songs moving on by themselves don't count.

### Playing a song from search
- **Albums, playlists, Favorites and folders** play in their order.
- **A song picked anywhere else** (search, recommendations, All songs, an artist) plays first, followed by a random queue from your whole library.

### More lyrics sources
- **Kugou and NetEase Cloud Music** are asked alongside LRCLIB; the best synced match wins (same title, closest length), and credit lines are stripped. The lyrics search box lists all three, synced first. QQ Music only answers requests that claim to come from its own site, so it's not used. Genius has no timed lyrics, so it stays a browser link.

### Window corners
- **The whole page is clipped** to Windows 11's 8 px rounded corners, and rounded corners are asked for explicitly. With Transparency effects off, the window uses a solid dark background instead of acrylic (which was solid grey anyway).

### Background picture and blur
- **Settings → Glass → Background:** Artwork, Colours, or **Your image**. Your image keeps your picture behind the glass whatever plays. It's stored at full size (up to 3840 px) and works best landscape 16:9 at high resolution, like 3840 × 2160 or 1920 × 1080. The row under it shows your picture's size and says if a sharper or 16:9 one would look better.
- **Background blur** slider (0–40 px) for the artwork or your picture. It was fixed at 3 px.
- **Softer window edge:** the rim around the window is thinner (1 px) with a gentler glow.

### Search box and scrollbars
- **Each tab keeps its own search.** Typing in Search no longer carries over to Library or the Queue. Search and Library each remember their own text, and it's back when you return to the tab.
- **The Queue has no search box.** It folds away when you open the Queue and unfolds in the other tabs. Ctrl+F from the Queue jumps to Search with the box ready.
- **Scrollbars are a white floating pill** (Settings, Edit info and every other sheet): no track, no arrows, clear of the edges.

### Public repo and updates (0.2.1)
- **The code is public** at https://github.com/pxlarized2/glass-player, checked for passwords, keys, tokens and personal paths first (none, in any commit).
- **Glass updates itself.** It checks GitHub 8 s after it opens and every 3 hours, downloads a new version in the background, and installs it when you restart (the popup bottom right has **Restart to update**) or the next time you close Glass. The portable exe can't replace itself, so it offers the download page instead.
- **Fixed: updates never switched on.** The packaged app has no `build` section in its package.json, so Glass couldn't see where to look. It now reads the repo from `resources/app-update.yml`, which every build carries. 0.2.0 had this bug, so 0.2.0 → 0.2.1 was installed by hand; later versions arrive by themselves.
- **"Glass updated" card:** the first time a new version opens, a glass card bottom right shows what's new (up to three changes with their pictures). **All changes** opens Settings at What's new. It leaves by itself after 20 s unless you're hovering it, and shows once per version. A fresh install doesn't show it.
- **Releases are built on your PC.** The GitHub Actions release workflow was removed.
- **The update popups sit higher,** clear of the player bar.

### Lyrics when the queue panel is wide (0.2.2)
- **The bug:** with the lyrics open and the queue panel dragged wider (or a small window), the cover vanished but the lyrics stayed squeezed into the right-hand column with an empty gap on the left. An older layout rule overrode the narrow layout, and the switch happened with no animation.
- **Now:** when there isn’t room for both, the lyrics fill the whole stage (top to bottom, lined up with the queue panel) and the cover sits small in their top-left corner, next to the lyrics source and buttons.
- **The switch is a water drop:** the cover shrinks as it falls into the corner, rounds into a drop, lands with a small squash and settles, while the lyrics pour out to fill the space. Widening again lifts the drop out of the corner and it swells back into the cover, with the title rising in underneath. Switches at 640 px of stage width going narrow and 680 px going wide, so it doesn’t flicker at the edge. The cover no longer drifts toward the mouse while it’s small.
- Checked off-screen at several widths and mid-animation in both directions; the normal layouts (no lyrics, lyrics side by side, empty library) measure the same as before.

### Smooth resizing (0.2.2)
- **Cards:** card grids (Library playlists, artists, albums) used to stretch wider while their rows kept the old height, so cards overlapped, then snapped into a new grid 140 ms after you stopped. Now every frame of a drag gives the rows the cards’ real height, and when a column comes or goes the cards glide from where they were to their new spots. A width sweep from 380 to 960 px and back (117 frames) found no overlap at any frame.
- **Lyrics:** the space above and below the lines came from the panel’s width, so the whole text slid up and down as you dragged. It now comes from the stage’s height, and on every size change the sung line is put back exactly where it was (plain lyrics keep their place in the text). Measured: the sung line stays within 6 px across every width, including the switch to and from the corner layout.

### Glassy (0.2.14)
- Glass Player is now **Glassy**: the window title, Start menu and desktop shortcuts, the installer, the program file and the app’s own messages. Older notes below still say "Glass".
- The update carries over by itself. It installs into your existing folder (`Programs\Glass Player`, which keeps that name), renames your shortcuts, and your library and settings stay in `%APPDATA%\Glass Player`. New installs go to `Programs\Glassy`, and also keep their data in `%APPDATA%\Glass Player`.
- The GitHub repo stays `glass-player`, because installed copies use it to find updates.

### Bright spots stay readable (0.2.13)
- The artwork and Your image backgrounds get a soft shadow over only their bright parts. Glass makes a tiny brightness map of the picture, once per picture: no shadow up to mid brightness, most of the way for white, spread slightly past the bright area so the soft edge falls outside it. A mostly dark cover with a white patch used to wash out the player bar because its average wasn’t bright; now only the patch is shaded and the rest keeps its full colour. A fully white cover becomes a soft grey as before. Your own image gets this too, which the old dimming had to skip.
- The Colours background keeps the overall dimming for bright covers, since it has no picture to shade.

### Cleaner tags (0.2.12)
- Tags are a name and a colour, shown with a small coloured dot on songs, in menus and in Edit info. Existing tags keep their name, colour and songs.

### Real artists (0.2.11)
- **Edit info’s artist list shows real artists.** It used to list every song’s raw tag, so "Playboi Carti & Lil Uzi Vert" counted as an artist. Collabs now count for each artist on them, and the list shows one name per artist.
- **Real names stay in one piece.** Glass checks names joined by a comma or "&" against Deezer’s public artist search, in the background and only once per name. A name stays whole only if Deezer has that exact name and it’s more popular than the names it would split into: "Tyler, the Creator", "Earth, Wind & Fire" and "Simon & Garfunkel" stay whole, while "Tyler, the Creator & Frank Ocean" and "Drake & Future" split. This also fixes artist pages and grouping for those acts. Only the names are sent; answers are kept in `artist-names.json` in Glass’s data folder. Offline it splits as before and checks again later.
- **Typing an artist** suggests real artists from Deezer, with photos, under the ones already in your library.
- **Clicking anywhere on the Artist or Album field opens its list,** even when the field is already filled in; typing then narrows it down.

### A heads-up for small pictures (0.2.10)
- **Adjust cover** (songs, albums, playlists) shows a small note when fewer than 600 of the picture’s own pixels would fill the square, including when you zoom far into a big picture: it may look blurry as the cover and in the background, and 1000 × 1000 or bigger stays sharp. It’s only a note; any picture can still be used.

### Bars that follow the music, lyrics as one motion (0.2.9)
- **The bars on the playing song react to the sound.** They were a looping animation. Now the first bar follows the low end (808s, kicks), the second the middle (vocals, snares), the third the top (hi-hats, ticks). Each band is measured against its own recent loudest and quietest, so quiet hats still move their bar fully and a long 808 doesn’t pin it at the top. Checked with a test track of 2 kicks and 8 hi-hats a second: the low bar moved 2 times a second and the top bar 8. When paused they settle low.
- **Lyrics open and close as one motion.** The cover, title and glass panel share one curve and timing, a gentle start and a soft landing (the old curve was most of the way there in a quarter of its time, which looked like snapping). The panel only moves and fades: the extra blur on top of its glass is gone. The cover’s glass frame is fitted before the first frame, so it no longer swaps partway through, which was the click.
- **Closing from the corner layout:** the cover rises over the fading panel instead of under it, the title fades in with it instead of appearing at once, and the lyrics header no longer jumps. **Opening into the corner layout** stays sharp the same way, with the title fading out.

### Simpler playback (0.2.8)
- Settings → Playback is down to **Fade in and out**. The rest is simply how Glass behaves now: clicking the song that’s playing restarts it, Autoplay is always on, songs run straight into each other with no crossfade, and play and pause have no audible fade (a 0.04 s ramp only stops the click). Old choices for these are cleared when Glass starts.

### The cover comes back cleanly (0.2.7)
- Making the queue panel smaller again (or the window bigger) used to send a frameless copy of the cover slowly out of the lyrics’ corner, rounding into a circle, while the lyrics slid across its spot; the real cover popped in at the end. Now the real cover, frame and all, fades in at its own spot and grows from small to full size, from its middle, and the lyrics only shift a little.
- Going the other way, the cover still shrinks into the lyrics’ corner and softens into the glass, but stays a rounded square: the round drop and the ripple ring are gone.

### Lyrics fixes and small polish (0.2.6)
- **Wrong lyrics, remove** is in the lyrics ••• menu for lyrics from any online source (LRCLIB, Kugou, NetEase), not only LRCLIB, and for ones wrongly marked instrumental. A removal is remembered as removed, so it no longer comes back by itself a week later; your own .lrc files and the song’s tags are never offered for removal.
- **Look again** really searches online again (it used to get the saved answer straight back).
- **Lyrics search bar:** no dot under the search icon (it gets a soft pressed background instead), no divider line under the bar, a calm focus glow instead of a bright ring, the field no longer grows into the Search button, and the button matches the field’s height and shape.
- **Playing marker:** the dark veil with moving bars on the playing song’s cover fades in and out with the song instead of switching on at once and popping up from small.

### Calm glass, bright covers, soft artwork (0.2.5)
- **Glass edges no longer flicker.** The colour wash behind everything was repainted 24 times a second, drifting and pulsing with the beat. Each repaint made every glass panel redo its blur and bent rim, and the rims bend whatever is behind them, so dark parts of the cover (a figure in the artwork) flickered along the bottom edges. It also cost a lot of frame rate on big screens. The wash now only moves while it glides to a new song’s colours (about 3 s) or follows a video; once settled it holds still (measured: 0 repaints in 4 s of playback, was about 100).
- **Bright covers stay readable.** Glass measures each cover’s brightness and, only for bright ones, darkens the background behind the glass and stops the glass brightening what’s behind it, easing in with the song’s colours. A white cover becomes a soft grey glow with clear white text; normal and dark covers are left exactly as they were. Not applied with your own image as the background.
- **Soft artwork background.** The artwork background has its own blur, at the maximum to start, so it reads as coloured light. Your own image keeps its own blur (low to start), and the Colours background has no blur slider at all. Upgrading keeps any blur you chose; an untouched old default moves to the new maximum.
- Fixed: picking a background in Settings now updates the blur slider (and opens the image picker for Your image) on the first click.

### Fullscreen, the glass taking the cover in, Windows controls (0.2.4)
- **Fullscreen fits the screen.** Hiding the title bar left the content in its 0 px row, so everything hung from the top edge. The content now spans the whole screen; on big stages (1500 px wide and 1000 px tall and up) the cover sits on the left and the lyrics on the right, centred, larger, and clear of the floating player bar. The black background is only behind videos now; music keeps the glass background.
- **The glass takes the cover in.** When the lyrics need the room, a full-size copy of the cover drifts into their corner, rounds into a drop and softens into the glass; the small cover surfaces from inside with a ripple. Widening lets it rise back out. The copy is only ever scaled down, so the picture stays sharp the whole way (before, the small cover was stretched up and looked blurry mid-way).
- **Windows media controls.** The pop-up for the volume and media keys (and the lock screen) shows the cover, and hovering Glass on the taskbar shows previous, play/pause and next buttons.
- **Updates install quietly.** Restart to update installs in the background with no setup window, and Glass opens again by itself.
- **New installs start clean:** the colour background, no extra darkness, no background blur, and Even out volume on. Saved settings always win, so existing setups look the same.
- **Quality line after a restart:** the line under the title ("MP3 · 320 kbps · HQ") was blank for the restored song until the next song; it now shows at once.
- Under the hood: standard Electron 44.10.2.

### Lyrics search without Genius (0.2.3)
- The lyrics search lists only LRCLIB, Kugou and NetEase results, which play along inside Glass. The "Search on Genius" link (words only, no timing, opened in the browser) is gone, and Glass no longer opens genius.com links at all.
- Releases now go out in one step (`npm run release` → `scripts/release.js`), so `latest.yml` can't go missing again.

### Updates find you (0.2.2)
- Glass looks for a new version 8 s after it opens, every 30 minutes, and when you come back to its window after 10 minutes away. A new version downloads quietly with a small progress card, then a card says it’s ready with **Restart to update** (Later shrinks it to a pill).
- Each finished batch of work now ships as a GitHub release with these notes, so your installed Glass picks it up by itself.

---

## Under the hood

- **Electron:** **44.10.2**.
- **Build:**
  ```bash
  npx electron-builder --win nsis portable -c.directories.output=dist-deck
  ```
  `build.electronDist` points at the local Electron in `node_modules/electron/dist`.
- **Publish a new version:** raise `version` in package.json, add its notes to `renderer/notes.js` (`v: 'x.y.z'`) and `build/release-notes.md`, commit and push, then:
  ```bash
  npm run release
  ```
  `scripts/release.js` checks the commit is pushed and the notes mention the version, builds, then creates the GitHub release `vX.Y.Z` once with the installer, blockmap, portable exe, `latest.yml` and the notes (needs `gh auth login`). electron-builder's own publishing is no longer used: it uploaded the two targets at once, both tried to create the release, and in 0.2.2 `latest.yml` went missing until it was added by hand. Installed copies pick a release up within half an hour (0.2.2 and later), or at their next start.
- **New dependencies:** `electron-updater`.
- **Your data** (library, edits, tags, plays, settings) is stored in the app's user folder, not in your music files. The only things that write to song files are Edit info's "Also save into the MP3 file's tags" box and "Save as .lrc".

### Files

| File | What it does |
|---|---|
| `main.js` | Window, file scanning, metadata + quality, covers, lyrics lookup, artist info (Wikipedia), artwork tools, updates |
| `preload.js` | The bridge between the window and `main.js` |
| `renderer/app.js` | Player core: library, queue, lists, menus, Edit info, albums, tabs, filters, links to where a song plays from |
| `renderer/deck.js` | Gapless engine: two players, preloading, crossfades, skips |
| `renderer/deck-worklet.js` | The audio worklet that splices songs together sample by sample |
| `renderer/lyrics.js` | Lyrics panel |
| `renderer/sound.js` | Sound effects chain (bass, EQ, reverb, leveller, mono, fades) |
| `renderer/art.js` | Cover Adjust, art from other songs, cover menu |
| `renderer/tags.js` | Tags |
| `renderer/extras.js` | Quality badges, plays, artist pages, links under the song, side-panel resize, recommendations, quick edits, cover drift |
| `renderer/liquid.js` | Liquid glass filters + artwork wallpaper (`Liquid.watch` adds small panels like the zoom pill) |
| `renderer/zoom.js` | Zoom pill (the zoom keys are handled in `main.js`) |
| `renderer/updates.js` | Update popup, and the "Glass updated" card after an update |
| `renderer/settings.js` | Settings: Sound, Playback, Updates, Glass |
| `renderer/undo.js` | Undo / redo (Ctrl+Z, Ctrl+Shift+Z) and the "Undone" pill |
| `renderer/eqgraph.js` | The draggable, glowing equalizer curve in Settings |
| `renderer/notes.js` | What's new: each change with its version and picture |

### How changes were checked
Every change was tested in an offscreen copy of the app with a separate test profile, so your library and screen were never touched. The tests used a generated test tone, a made-up library and a few of your real songs (read only). Lyrics were checked with made-up lines and line counts only.

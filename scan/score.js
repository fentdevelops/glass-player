// Song score: decides whether a file looks like a song, from signals we already have (length, tags, names,
// folders, sound format, neighbours). Plain Node, no Electron. Nothing here touches the disk.

const START = 60;
const THRESHOLD = 50;

const POINTS = {
  tooShort: -70,       // under 45 s
  shortish: -15,       // 45-90 s
  tooLong: -60,        // over 30 minutes
  titleAndArtist: 15,
  oneOfTitleArtist: 5,
  album: 10,
  noTags: -10,
  nameJunk: -45,       // junk word in the file or folder name, file has no title + artist tags
  nameJunkTagged: -10, // same, but the file is properly tagged (a song called "Hat Trick")
  voiceSound: -40,     // mono at a low sample rate
  gameFolder: -40,
  album3: 15,          // several tagged files of the same album in one folder
};

const SHORT_SECONDS = 45;
const SHORTISH_SECONDS = 90;
const LONG_SECONDS = 30 * 60;
const LOW_SAMPLE_RATE = 24000;
const ALBUM_NEIGHBOURS = 3;

// Whole words only, so "Whatever" doesn't match "hat".
const SFX_WORDS = ['sfx', 'sound effect', 'sound effects', 'soundeffect', 'notification', 'notifications', 'ringtone', 'ringtones', 'alarm'];
const VOICE_WORDS = ['recording', 'recordings', 'voice memo', 'voice memos', 'voice note', 'voicenote', 'whatsapp audio', 'ptt', 'voice message'];
const SAMPLE_WORDS = ['kick', 'snare', 'hat', 'hihat', 'loop', 'loops', 'one-shot', 'one shot', 'oneshot', 'sample', 'samples', 'stem', 'stems', 'bpm', 'pack', 'packs'];
const GAME_FOLDER = /game|steamapps|unity|unreal|godot|renpy/i;

function wordRegex(words) {
  const alt = words.map((w) => w.replace(/[-\s]/g, '[-_\\s]?')).join('|');
  return new RegExp(`(^|[^a-z0-9])(${alt})($|[^a-z0-9])`, 'i');
}
const SFX_RE = wordRegex(SFX_WORDS);
const VOICE_RE = wordRegex(VOICE_WORDS);
const SAMPLE_RE = wordRegex(SAMPLE_WORDS);
const BPM_RE = /\d\s*bpm/i;

function splitPath(p) {
  const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
  const file = parts.pop() || '';
  return { file: file.replace(/\.[^.]+$/, ''), folders: parts };
}

function scoreFile(f) {
  const { file, folders } = splitPath(f.path);
  let score = START;
  const against = []; // { pts, text }
  // `named` reasons (what the file is) are more useful to show than a length, so they win ties of any size
  const add = (pts, text, named) => { score += pts; if (pts < 0 && text) against.push({ pts, text, named: !!named }); };

  const hasTitle = !!f.title, hasArtist = !!f.artist, hasAlbum = !!f.album;

  // length (a missing duration is judged on the other signals)
  if (typeof f.duration === 'number' && f.duration > 0) {
    const d = f.duration;
    if (d < SHORT_SECONDS) add(POINTS.tooShort, `${Math.round(d)} seconds, too short for a song`);
    else if (d < SHORTISH_SECONDS) add(POINTS.shortish, `${Math.round(d)} seconds, quite short`);
    else if (d > LONG_SECONDS) add(POINTS.tooLong, 'over 30 minutes, likely a podcast or audiobook');
  }

  // tags
  if (hasTitle && hasArtist) add(POINTS.titleAndArtist);
  else if (hasTitle || hasArtist) add(POINTS.oneOfTitleArtist);
  else if (!hasAlbum) add(POINTS.noTags, 'no tags');
  if (hasAlbum) add(POINTS.album);

  // names and folders
  const tagged = hasTitle && hasArtist;
  const junkPts = tagged ? POINTS.nameJunkTagged : POINTS.nameJunk;
  const texts = [file, ...folders.slice(-3)];
  const hit = (re) => texts.some((t) => re.test(t));
  if (hit(VOICE_RE)) add(junkPts, 'looks like a voice recording', true);
  else if (hit(SFX_RE)) add(junkPts, 'looks like a sound effect', true);
  else if (hit(SAMPLE_RE) || BPM_RE.test(file)) add(junkPts, 'looks like part of a sample pack', true);
  if (folders.slice(-4).some((s) => GAME_FOLDER.test(s))) add(POINTS.gameFolder, 'inside a game or app folder', true);

  // sound
  if (f.channels === 1 && f.sampleRate > 0 && f.sampleRate < LOW_SAMPLE_RATE) add(POINTS.voiceSound, 'looks like a voice recording', true);

  // neighbours
  if (hasAlbum && f.albumNeighbours >= ALBUM_NEIGHBOURS) add(POINTS.album3);

  const ticked = score >= THRESHOLD;
  let reason = null;
  if (!ticked) {
    against.sort((a, b) => (b.named - a.named) || (a.pts - b.pts));
    reason = against.length ? against[0].text : "doesn't look like a song";
  }
  return { score, ticked, reason };
}

module.exports = { scoreFile, THRESHOLD, POINTS };

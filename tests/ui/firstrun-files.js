'use strict';
// Scratch folders for the song finder's UI tests: real small audio files under the system temp folder. Nothing here looks
// at, or writes to, any other folder. Each folder is built the first time a run asks for it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-finder-'));

function chunk(id, buf) {
  const h = Buffer.alloc(8);
  h.write(id, 0, 'latin1');
  h.writeUInt32LE(buf.length, 4);
  return Buffer.concat([h, buf, buf.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
// A real WAV: 8-bit at a very low sample rate, so a three minute song is a few kilobytes. Tags go in a LIST INFO chunk.
function wav({ seconds = 200, rate = 10, channels = 2, title, artist, album } = {}) {
  const data = Buffer.alloc(Math.round(seconds * rate) * channels, 128);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(channels, 2); fmt.writeUInt32LE(rate, 4); fmt.writeUInt32LE(rate * channels, 8); fmt.writeUInt16LE(channels, 12); fmt.writeUInt16LE(8, 14);
  const tag = (id, v) => (v ? [chunk(id, Buffer.from(v + '\0', 'latin1'))] : []);
  const info = [...tag('INAM', title), ...tag('IART', artist), ...tag('IPRD', album)];
  const list = info.length ? [chunk('LIST', Buffer.concat([Buffer.from('INFO'), ...info]))] : [];
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), ...list, chunk('data', data)]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
// A real Ogg Vorbis stream, as far as a tag reader goes: its headers and an end page that gives the length.
function oggPage(flags, granule, seq, packet) {
  const segs = [];
  let left = packet.length;
  while (left >= 255) { segs.push(255); left -= 255; }
  segs.push(left);
  const h = Buffer.alloc(27 + segs.length);
  h.write('OggS', 0, 'latin1'); h[5] = flags; h.writeBigInt64LE(BigInt(granule), 6); h.writeUInt32LE(1234, 14); h.writeUInt32LE(seq, 18); h[26] = segs.length;
  segs.forEach((s, i) => { h[27 + i] = s; });
  return Buffer.concat([h, packet]);
}
function ogg(seconds, rate = 44100) {
  const id = Buffer.alloc(30);
  id[0] = 1; id.write('vorbis', 1, 'latin1'); id[11] = 2; id.writeUInt32LE(rate, 12); id.writeInt32LE(96000, 20); id[28] = 0xb8; id[29] = 1;
  const vendor = Buffer.from('glassy-test'), c = Buffer.alloc(7 + 4 + vendor.length + 4 + 1);
  c[0] = 3; c.write('vorbis', 1, 'latin1'); c.writeUInt32LE(vendor.length, 7); vendor.copy(c, 11); c[c.length - 1] = 1;
  return Buffer.concat([oggPage(2, 0, 0, id), oggPage(0, 0, 1, c), oggPage(4, Math.round(seconds * rate), 2, Buffer.alloc(16))]);
}
function put(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

// builds a set once; returns "Music;Downloads", ready for GLASS_SCAN_ROOTS
const built = new Map();
function set(name, build) {
  if (!built.has(name)) {
    const music = path.join(scratch, name, 'Music'), downloads = path.join(scratch, name, 'Downloads');
    fs.mkdirSync(music, { recursive: true });
    fs.mkdirSync(downloads, { recursive: true });
    build(music, downloads);
    built.set(name, { music, downloads });
  }
  return built.get(name);
}
const roots = (s) => `${s.music};${s.downloads}`;

// The test's own library: exactly 12 songs (5 + 4 + 2 + 1) and 4 files that probably aren't songs.
const small = () => set('small', (music, downloads) => {
  const beatles = ['Come Together', 'Something', 'Oh! Darling', "Octopus's Garden", 'Here Comes the Sun'];
  beatles.forEach((title, i) => put(path.join(music, 'The Beatles', 'Abbey Road', `0${i + 1} ${title.replace(/[!']/g, '')}.wav`), wav({ title, artist: 'The Beatles', album: 'Abbey Road', seconds: 180 + i })));
  ['Weird Fishes', 'Reckoner'].forEach((title) => put(path.join(music, 'Radiohead', 'In Rainbows', `${title}.wav`), wav({ title, artist: 'Radiohead', album: 'In Rainbows' })));
  // loose files by folder. One carries an album tag of its own: on its own in the folder that's not an album worth a group
  for (const n of ['Summer Mix', 'Late Night', 'Rock & Roll Forever']) put(path.join(music, 'Mixtapes', `${n}.wav`), wav());
  put(path.join(music, 'Mixtapes', 'Lonely Single.wav'), wav({ title: '<b>Not bold</b> & Co', artist: 'Someone', album: 'Only One' }));
  put(path.join(downloads, '夜に駆ける.wav'), wav());
  // and the ones that aren't songs
  put(path.join(downloads, 'ding.ogg'), ogg(9));
  put(path.join(downloads, 'notification.wav'), wav({ seconds: 3 }));
  put(path.join(downloads, 'Voice memo 3.wav'), wav({ seconds: 100, rate: 1000, channels: 1 }));
  put(path.join(downloads, 'long talk.wav'), wav({ seconds: 31 * 60 }));
});

// nothing to find at all
const none = () => set('none', () => {});

// only files that probably aren't songs
const onlyJunk = () => set('junk', (music, downloads) => {
  put(path.join(downloads, 'ding.ogg'), ogg(9));
  put(path.join(downloads, 'notification.wav'), wav({ seconds: 3 }));
});

// lots of folders of a few songs each: more than a dozen groups, and the songs come in over many messages
const folders = (count, each) => set(`folders-${count}-${each}`, (music) => {
  for (let f = 0; f < count; f++) {
    const album = `Album ${String(f + 1).padStart(3, '0')}`;
    for (let s = 0; s < each; s++) put(path.join(music, 'Artist', album, `${String(s + 1).padStart(3, '0')}.wav`), wav({ title: `${album} song ${s + 1}`, artist: `Artist ${f % 7}`, album }));
  }
});

// one folder holding a lot of loose songs: a single group that has to be windowed
const oneBig = (count) => set(`one-${count}`, (music) => {
  for (let s = 0; s < count; s++) put(path.join(music, 'Everything', `Track ${String(s + 1).padStart(4, '0')}.wav`), wav({ seconds: 120 + (s % 200) }));
});

// groups that grow as the walk goes on: each new folder is the biggest yet, so it lands above everything already showing
const growing = (count) => set(`growing-${count}`, (music) => {
  for (let f = 0; f < count; f++) {
    const album = `Grow ${String(f + 1).padStart(3, '0')}`;
    for (let s = 0; s < f + 2; s++) put(path.join(music, album, `${String(s + 1).padStart(3, '0')}.wav`), wav({ title: `${album} song ${s + 1}`, artist: 'Grower', album }));
  }
});

// every file in a set, as the scan will see it
const filesIn = (s) => fs.readdirSync(path.dirname(s.music), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

// A believable library to look at in the pictures: invented names, the mix of things a real Music and Downloads has
const WORDS = ['Slow', 'Motion', 'Night', 'Drive', 'Paper', 'Moons', 'Glass', 'House', 'Long', 'Way', 'Home', 'Silver', 'Tide', 'Echo', 'Park', 'Golden', 'Hour', 'Static', 'Bloom', 'Northern', 'Lights', 'Velvet', 'Rain', 'Hollow', 'Sky', 'Neon', 'Garden', 'Quiet', 'Storm', 'Wild', 'Heart', 'Open', 'Road'];
const phrase = (i, n = 2) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 11 + (i >> 2)) % WORDS.length]).join(' ');
const ALBUMS = [['Paper Moons', 'Violet Hours', 14], ['Long Way Home', 'The Understudies', 11], ['Glasshouse', 'Marlow', 10], ['Golden Hour Tapes', 'Sora Vale', 9], ['Northern Lights', 'Various', 7], ['Static Bloom', 'Marlow', 6]];
const gallery = () => set('gallery', (music, downloads) => {
  let n = 0;
  for (const [album, artist, count] of ALBUMS) {
    for (let s = 0; s < count; s++) put(path.join(music, artist, album, `${String(s + 1).padStart(2, '0')} ${phrase(n)}.wav`), wav({ title: phrase(n++), artist, album, seconds: 150 + (n * 13) % 170 }));
  }
  for (let s = 0; s < 18; s++) put(path.join(downloads, `${phrase(n++, 3)}.wav`), wav({ seconds: 140 + (n * 17) % 160 }));
  for (let s = 0; s < 6; s++) put(path.join(music, 'Old mixes', `${phrase(n++)} mix.wav`), wav({ seconds: 300 + (n * 31) % 900 }));
  put(path.join(downloads, '夜に駆ける.wav'), wav());
  put(path.join(downloads, 'Überall & immer.wav'), wav());
  put(path.join(downloads, 'ding.ogg'), ogg(9));
  put(path.join(downloads, 'notification.wav'), wav({ seconds: 3 }));
  put(path.join(downloads, 'Voice memo 3.wav'), wav({ seconds: 100, rate: 1000, channels: 1 }));
  put(path.join(downloads, 'long talk.wav'), wav({ seconds: 31 * 60 }));
  put(path.join(downloads, 'Drum samples', 'kick 01.wav'), wav({ seconds: 2 }));
  put(path.join(downloads, 'Drum samples', 'snare 04.wav'), wav({ seconds: 2 }));
});

module.exports = { scratch, roots, small, none, onlyJunk, folders, oneBig, growing, gallery, filesIn };

'use strict';
// "What's new" at the bottom of Settings: the latest changes, each with a small picture drawn in the app's colours.
(() => {
  // shared backdrop for every picture: the app's indigo → violet → pink → amber wash with a glass lens
  const wash = (id, body) => `<svg viewBox="0 0 96 64" aria-hidden="true"><defs>
      <linearGradient id="pn${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2b9e"/><stop offset=".45" stop-color="#7c3be0"/><stop offset=".8" stop-color="#f2589c"/><stop offset="1" stop-color="#ffab68"/></linearGradient>
      <radialGradient id="pg${id}" cx=".3" cy=".25" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="96" height="64" rx="12" fill="url(#pn${id})"/><rect width="96" height="64" rx="12" fill="url(#pg${id})"/>
    <g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
  const NOTES = [
    { v: '0.2.14', title: 'Glass Player is now Glassy', text: 'Same app, same library, same everything, with a better name.',
      art: wash(33, '<text x="48" y="41" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="24" fill="#fff" stroke="none">G</text>') },
    { v: '0.2.13', title: 'Bright spots stay readable', text: 'A soft shadow now sits over only the bright parts of the background, so a white patch can\u2019t wash out the player while everything else keeps its colour.',
      art: wash(32, '<circle cx="48" cy="32" r="18" fill="rgba(0,0,0,.28)" stroke="none"/><circle cx="48" cy="32" r="8" fill="#fff" stroke="none"/>') },
    { v: '0.2.12', title: 'Cleaner tags', text: 'Tags are now just a name and a colour.',
      art: wash(31, '<path d="M26 32V20a2 2 0 0 1 2-2h14l26 14-26 14H28a2 2 0 0 1-2-2z"/><circle cx="36" cy="26" r="2.4" fill="#fff"/>') },
    { v: '0.2.11', title: 'Real artists', text: 'Edit info lists real artists instead of collab strings, and typing a name suggests real artists with their photos. Names like Earth, Wind & Fire stay in one piece.',
      art: wash(29, '<circle cx="48" cy="25" r="9"/><path d="M31 49c2-9 9-13 17-13s15 4 17 13"/>') },
    { v: '0.2.11', title: 'Album list opens on click', text: 'Clicking anywhere on the Artist or Album field opens its list. No more aiming for the little arrow.',
      art: wash(30, '<rect x="18" y="16" width="60" height="13" rx="5"/><path d="M26 38h44M26 47h30" opacity=".7"/>') },
    { v: '0.2.10', title: 'A heads-up for small pictures', text: 'When a cover you pick is low quality, Adjust cover says so, so it won\u2019t surprise you as a blurry cover or background.',
      art: wash(28, '<rect x="30" y="14" width="36" height="36" rx="7"/><path d="M48 24v12"/><circle cx="48" cy="42" r="1.4" fill="#fff"/>') },
    { v: '0.2.9', title: 'Bars that follow the music', text: 'The bars on the playing song react to the sound: one to the 808s and kicks, one to the vocals and snares, one to the hi-hats.',
      art: wash(26, '<path d="M36 46V26M48 46V36M60 46V18"/>') },
    { v: '0.2.9', title: 'Lyrics open and close as one motion', text: 'The cover and the glass panel now move together, with a gentle start and a soft landing, and nothing clicks into place.',
      art: wash(27, '<rect x="14" y="20" width="24" height="24" rx="5"/><rect x="46" y="14" width="36" height="36" rx="7" opacity=".55"/><path d="M38 32h8" opacity=".8"/>') },
    { v: '0.2.8', title: 'Simpler playback', text: 'Clicking the playing song restarts it, Autoplay is always on, songs run straight into each other, and pause stops right away. Fade in and out is the one setting left.',
      art: wash(25, '<path d="M38 22v20l16-10z"/><path d="M62 22v20"/>') },
    { v: '0.2.7', title: 'The cover comes back cleanly', text: 'Making the queue panel smaller again fades the cover in at its spot, small to big. No more slow trip across the screen.',
      art: wash(24, '<rect x="36" y="20" width="24" height="24" rx="5"/><rect x="29" y="13" width="38" height="38" rx="8" opacity=".4"/>') },
    { v: '0.2.6', title: 'Wrong lyrics? Remove them', text: 'Lyrics from any online source can be removed from the ••• menu, and they stay gone. Look again really searches again.',
      art: wash(21, '<path d="M26 24h30M26 32h22M26 40h26"/><path d="M62 26l12 12M74 26L62 38"/>') },
    { v: '0.2.6', title: 'Tidier lyrics search', text: 'An even gap, a field that stays put, and no stray dot or bright line.',
      art: wash(22, '<rect x="14" y="24" width="48" height="16" rx="6"/><rect x="66" y="24" width="18" height="16" rx="6"/>') },
    { v: '0.2.6', title: 'Softer playing marker', text: 'The playing song’s cover fades its marker in and out instead of flashing up.',
      art: wash(23, '<rect x="30" y="16" width="32" height="32" rx="7" opacity=".5"/><path d="M40 40v-8M46 40V28M52 40v-6"/>') },
    { v: '0.2.5', title: 'Calm, smooth glass', text: 'The background holds still once a song’s colours settle, so the glass edges stop flickering and everything runs smoother.',
      art: wash(18, '<path d="M14 40c10-8 20-8 34 0s24 8 34 0" opacity=".45"/><path d="M14 30h68"/>') },
    { v: '0.2.5', title: 'Bright covers stay readable', text: 'A white or bright cover dims the background just enough to keep the text clear. Dark covers are untouched.',
      art: wash(19, '<circle cx="40" cy="32" r="12" fill="#fff" stroke="none"/><path d="M60 26h18M60 34h12"/>') },
    { v: '0.2.5', title: 'Soft artwork background', text: 'The artwork background starts fully blurred, like coloured light. Your own image keeps its own blur.',
      art: wash(20, '<circle cx="36" cy="32" r="14" fill="rgba(255,255,255,.25)" stroke="none"/><circle cx="60" cy="30" r="16" fill="rgba(255,255,255,.18)" stroke="none"/>') },
    { v: '0.2.4', title: 'Fullscreen fits your screen', text: 'Cover on the left, lyrics on the right, centred and sized for big screens.',
      art: wash(14, '<rect x="14" y="16" width="26" height="26" rx="5"/><path d="M50 20h32M50 29h26M50 38h30"/><path d="M8 52h80" opacity=".5"/>') },
    { v: '0.2.4', title: 'The glass takes the cover in', text: 'When the lyrics need room, the cover sinks into their glass and surfaces small in the corner, sharp all the way.',
      art: wash(15, '<circle cx="34" cy="26" r="10"/><circle cx="62" cy="38" r="6" opacity=".7"/><circle cx="62" cy="38" r="13" opacity=".35"/>') },
    { v: '0.2.4', title: 'Windows media controls', text: 'The volume and lock-screen pop-up shows the cover, and Glassy’s taskbar preview has play, pause and skip buttons.',
      art: wash(16, '<path d="M30 24v16M33 32l12-8v16z"/><path d="M52 24v16M60 24v16"/><path d="M78 24v16M75 32l-10-7v14z"/>') },
    { v: '0.2.4', title: 'Updates install quietly', text: 'Restart to update now installs in the background and Glassy opens again by itself.',
      art: wash(17, '<path d="M48 18a14 14 0 1 1-13 9"/><path d="M33 20l2 8 8-2"/>') },
    { v: '0.2.3', title: 'Lyrics search stays in Glassy', text: 'Search lists only lyrics that play along inside Glassy, from LRCLIB, Kugou and NetEase. The Genius link is gone.',
      art: wash(13, '<circle cx="42" cy="30" r="11"/><path d="M50 38l9 9"/><path d="M64 22h14M64 30h10" opacity=".7"/>') },
    { v: '0.2.2', title: 'Lyrics make room', text: 'With a wide queue panel, the lyrics fill the space and the cover drops into their corner like a water drop.',
      art: wash(9, '<path d="M48 14c8 10 13 17 13 23a13 13 0 0 1-26 0c0-6 5-13 13-23z" fill="rgba(255,255,255,.18)"/><path d="M24 50h48" opacity=".6"/>') },
    { v: '0.2.2', title: 'Smooth resizing', text: 'Cards and lyrics follow the panel while you drag it, with no overlapping or jumping.',
      art: wash(10, '<rect x="18" y="18" width="34" height="28" rx="5" opacity=".55"/><path d="M60 32h20M74 26l6 6-6 6M66 26l-6 6 6 6"/>') },
    { v: '0.2.2', title: 'Updates find you', text: 'Glassy looks for new versions every half hour and tells you when one is ready.',
      art: wash(11, '<path d="M38 42V30a10 10 0 0 1 20 0v12l4 4H34z"/><path d="M44 50a4 4 0 0 0 8 0"/>') },
    { v: '0.2.1', title: 'Glassy updates itself', text: 'New versions download quietly in the background and install when you restart.',
      art: wash(8, '<circle cx="48" cy="32" r="19" opacity=".45"/><path d="M48 20v20M40 33l8 8 8-8"/><path d="M38 47h20"/>') },
    { title: 'Undo anything', text: `${modName}+Z puts back what you just did. ${modName}+Shift+Z does it again.`,
      art: wash(2, '<path d="M36 26h18a10 10 0 0 1 0 20H42"/><path d="M42 19l-7 7 7 7"/>') },
    { title: 'Equalizer curve', text: 'Drag the points on a smooth, glowing curve. Double-click one to reset it.',
      art: wash(3, '<path d="M14 40 C26 40 28 22 40 24 S54 44 64 34 S78 22 84 26"/><circle cx="40" cy="24" r="3" fill="#fff"/><circle cx="64" cy="34" r="3" fill="#fff"/>') },
    { title: 'Glass colour', text: 'Tint every glass panel from a palette, or pick any colour.',
      art: wash(4, '<circle cx="36" cy="32" r="9" fill="rgba(159,183,255,.9)" stroke="none"/><circle cx="50" cy="32" r="9" fill="rgba(255,124,200,.85)" stroke="none"/><circle cx="64" cy="32" r="9" fill="rgba(126,224,161,.85)" stroke="none"/>') },
    { title: 'Speed next to Lyrics', text: 'The 1× button in the player changes speed and shows what it’s set to.',
      art: wash(5, '<text x="48" y="39" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="20" fill="#fff" stroke="none">1.5×</text>') },
    { title: 'More synced lyrics', text: 'Glassy now searches several lyrics sources and prefers ones that follow the song.',
      art: wash(6, '<path d="M28 24h40M28 32h30M28 40h36"/><circle cx="22" cy="32" r="2.4" fill="#fff"/>') },
    { title: 'Gapless albums', text: 'Two players take turns, so albums flow with no gap and no click.',
      art: wash(7, '<path d="M12 32h8l4-10 5 20 5-16 4 6h6"/><path d="M50 32h8l4-12 5 22 5-14 4 4h8" opacity=".75"/>') },
  ];
  NOTES.forEach((n) => { n.v = n.v || '0.2.0'; });
  const num = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).map(Number);
  const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const since = (v) => NOTES.filter((n) => newer(n.v, v));
  function html() {
    return `<div class="pn-list">${NOTES.map((n) => `<div class="pn-card"><div class="pn-art">${n.art}</div><div class="pn-text"><b>${n.title}</b><span>${n.text}</span></div></div>`).join('')}</div>`;
  }
  window.PatchNotes = { html, NOTES, since, newer };
})();

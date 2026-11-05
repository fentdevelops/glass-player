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
    { v: '0.2.1', title: 'Glass updates itself', text: 'New versions download quietly in the background and install when you restart.',
      art: wash(8, '<circle cx="48" cy="32" r="19" opacity=".45"/><path d="M48 20v20M40 33l8 8 8-8"/><path d="M38 47h20"/>') },
    { title: 'Spotify plays inside Glass', text: 'No Spotify app needed. Glass sets itself up in three quick steps.',
      art: wash(1, '<circle cx="48" cy="32" r="17" fill="rgba(255,255,255,.18)"/><path d="M39 26c6-2 13-1 18 2M40 32c5-1.5 10-1 14 1.5M41 38c4-1 7-.6 10 1"/>') },
    { title: 'Undo anything', text: 'Ctrl+Z puts back what you just did. Ctrl+Shift+Z does it again.',
      art: wash(2, '<path d="M36 26h18a10 10 0 0 1 0 20H42"/><path d="M42 19l-7 7 7 7"/>') },
    { title: 'Equalizer curve', text: 'Drag the points on a smooth, glowing curve. Double-click one to reset it.',
      art: wash(3, '<path d="M14 40 C26 40 28 22 40 24 S54 44 64 34 S78 22 84 26"/><circle cx="40" cy="24" r="3" fill="#fff"/><circle cx="64" cy="34" r="3" fill="#fff"/>') },
    { title: 'Glass colour', text: 'Tint every glass panel from a palette, or pick any colour.',
      art: wash(4, '<circle cx="36" cy="32" r="9" fill="rgba(159,183,255,.9)" stroke="none"/><circle cx="50" cy="32" r="9" fill="rgba(255,124,200,.85)" stroke="none"/><circle cx="64" cy="32" r="9" fill="rgba(126,224,161,.85)" stroke="none"/>') },
    { title: 'Speed next to Lyrics', text: 'The 1× button in the player changes speed and shows what it’s set to.',
      art: wash(5, '<text x="48" y="39" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="20" fill="#fff" stroke="none">1.5×</text>') },
    { title: 'More synced lyrics', text: 'Glass now searches several lyrics sources and prefers ones that follow the song.',
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

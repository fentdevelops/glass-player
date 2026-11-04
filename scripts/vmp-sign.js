// electron-builder afterPack: VMP-sign the packaged app with castlabs EVS, so Widevine
// (and with it Spotify's in-app player) accepts it. Needs a free castlabs account, made once with:
//   py -m castlabs_evs.account signup
// If signing isn't set up the build still finishes, with a warning.
// When signing works, resources/vmp-signed is left in the build: Glass only offers to play Spotify inside
// itself when it's there (an unsigned build would just fail every song and make Spotify skip through the queue).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
exports.default = async function vmpSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  const marker = path.join(context.appOutDir, 'resources', 'vmp-signed');
  try {
    fs.writeFileSync(marker, new Date().toISOString());
    // stdin ignored: with no castlabs account it fails here instead of waiting for typing
    execFileSync('py', ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log('  • VMP signed for Widevine:', context.appOutDir);
  } catch (e) {
    try { fs.unlinkSync(marker); } catch { /* not there */ }
    console.warn('  • VMP signing skipped (' + (e.message || e).toString().split('\n')[0] + ').\n'
      + '    Spotify playback inside Glass needs it. Run once:  py -m castlabs_evs.account signup');
  }
};

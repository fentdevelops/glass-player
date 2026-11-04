// electron-builder afterPack: VMP-sign the packaged app with castlabs EVS, so Widevine
// (and with it Spotify's in-app player) accepts it. Needs a free castlabs account, made once with:
//   py -m castlabs_evs.account signup
// If signing isn't set up the build still finishes, with a warning.
const { execFileSync } = require('child_process');
exports.default = async function vmpSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  try {
    execFileSync('py', ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
    console.log('  • VMP signed for Widevine:', context.appOutDir);
  } catch (e) {
    console.warn('  • VMP signing skipped (' + (e.message || e).toString().split('\n')[0] + ').\n'
      + '    Spotify playback inside Glass needs it. Run once:  py -m castlabs_evs.account signup');
  }
};

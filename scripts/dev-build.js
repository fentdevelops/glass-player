'use strict';
// npm run dev-build: makes Glassy Dev, the owner's private test copy: one .exe in dist-dev/, with the red icon.
// It runs next to the real Glassy with its own library and settings, and never looks for updates (main.js checks
// the glassyChannel value set below). Nothing is uploaded anywhere.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-dev');
const { version } = require('../package.json');
const eb = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

execFileSync(eb, [
  '--win', 'portable', '--publish', 'never',
  '-c.directories.output=dist-dev',
  '"-c.productName=Glassy Dev"',
  '-c.appId=com.glass.player.dev',
  '-c.win.icon=build/icon-dev.png',
  '"-c.extraMetadata.productName=Glassy Dev"',
  '-c.extraMetadata.glassyChannel=dev',
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

const exe = fs.readdirSync(out).find((f) => f.startsWith('Glassy Dev') && f.endsWith('.exe') && f.includes(version));
if (!exe) throw new Error('The test version was not built.');
console.log(`Built ${path.join(out, exe)}`);

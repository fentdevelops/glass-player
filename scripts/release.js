'use strict';
// npm run release: build the installer + portable copy, then publish them as one GitHub release with
// build/release-notes.md as its notes. Installed copies of Glass read latest.yml from the newest release
// and update themselves.
//
// Why not electron-builder's own publishing: it uploads the two targets at the same time and both try to create
// the release, so one fails ("Published releases must have a valid tag") and latest.yml can go missing, which
// leaves every installed Glass blind to the update. Here the release is created once, with every file in it.
//
// Needs the GitHub CLI signed in (gh auth login). Push the commit first: the release is tagged on it.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-deck');
const { version } = require('../package.json');
const tag = 'v' + version;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false, ...opts });
const read = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

const gh = ['gh', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe')]
  .find((g) => { try { execFileSync(g, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!gh) throw new Error('GitHub CLI not found. Install it and run gh auth login.');

// the release is tagged on the pushed commit, so check it's there before building anything
const head = read('git', ['rev-parse', 'HEAD']);
const remote = read('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
if (head !== remote) throw new Error(`Push first: main on GitHub is ${remote.slice(0, 7)}, this checkout is ${head.slice(0, 7)}.`);
try { execFileSync(gh, ['release', 'view', tag], { cwd: root, stdio: 'ignore' }); throw new Error(`${tag} already exists on GitHub. Bump the version in package.json.`); }
catch (e) { if (/already exists/.test(e.message)) throw e; }
const notes = path.join(root, 'build', 'release-notes.md');
if (!fs.readFileSync(notes, 'utf8').includes(version)) throw new Error(`build/release-notes.md doesn't mention ${version} yet.`);

const eb = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
run(eb, ['--win', 'nsis', 'portable', '--publish', 'never', '-c.directories.output=dist-deck'], { shell: process.platform === 'win32' });

// GitHub names assets without spaces; latest.yml already points at the dashed names
const files = [
  [`Glass Player Setup ${version}.exe`, `Glass-Player-Setup-${version}.exe`],
  [`Glass Player Setup ${version}.exe.blockmap`, `Glass-Player-Setup-${version}.exe.blockmap`],
  [`Glass Player ${version}.exe`, `Glass-Player-${version}.exe`],
  ['latest.yml', 'latest.yml'],
];
const yml = fs.readFileSync(path.join(out, 'latest.yml'), 'utf8');
if (!yml.includes(`version: ${version}`)) throw new Error('latest.yml was not written for ' + version);
const stage = path.join(out, 'upload-' + version);
fs.mkdirSync(stage, { recursive: true });
const up = files.map(([from, to]) => { const dest = path.join(stage, to); fs.copyFileSync(path.join(out, from), dest); return dest; });

run(gh, ['release', 'create', tag, ...up, '--title', `Glass ${version}`, '--notes-file', notes, '--target', head, '--latest']);
console.log(`Published ${tag}: installed copies of Glass will pick it up within half an hour.`);

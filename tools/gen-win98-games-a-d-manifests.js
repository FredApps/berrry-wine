#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(ROOT, 'test/binaries/win98-games-a-d');
const CHECK = process.argv.includes('--check');

const GAMES = [
  {
    id: 'black_white_2_demo',
    root: 'Black and White 2-DX9-D3D/installed',
    exe: 'BW2Demo.exe',
  },
  {
    id: 'curse_monkey_island_demo',
    root: 'Curse of Monkey Island demo-SW',
    exe: 'COMI.EXE',
  },
  {
    id: 'broken_sword_demo',
    root: 'Broken_Sword_demo-SW/installed',
    exe: 'winsword.exe',
    media: ['MUSIC', 'SMACKSHI', 'SPEECH'],
  },
  {
    id: 'dungeon_keeper_demo',
    root: 'Dungeon Keeper Demo-SWonly/installed',
    exe: 'KEEPER95.EXE',
  },
  {
    id: 'darkstone_demo',
    root: 'DarkstoneDemo-D3D/installed',
    exe: 'darkstonedemo.exe',
  },
  {
    // The CD's INSTALL\ directory is the game itself: RA95.EXE runs from it
    // unpacked, with MAIN.MIX/REDALERT.MIX beside it.
    id: 'red_alert_95_demo',
    root: 'CnC-Red Alert Demo-SW/INSTALL',
    exe: 'RA95.EXE',
  },
  {
    // rlapi.dll and SIMFORCE.dll are LoadLibrary'd from the game directory;
    // data/ and moves/ must keep their subdirectories.
    id: 'die_by_the_sword_demo',
    root: 'Die by the sword demo-SW+Glide',
    exe: 'dbts_demo.exe',
  },
  {
    // The magazine demo runs unpacked; its ANIMATE/, AVI/, INTRO/ and
    // per-map directories must keep their structure.
    id: 'dark_colony_demo',
    root: 'DarkColony-MagDemo-SW',
    exe: 'dc.exe',
  },
  {
    // Setup (Ssp.ini: SourcePath1 = game\, LangExeclusive = DOC\English)
    // copies GAME\ and the language's DOC files into one directory; the game
    // refuses to start without thanks.txt beside it.
    id: 'daytona_usa_deluxe_demo',
    root: 'DaytonaUSA Deluxe-SWonly/GAME',
    exe: 'DAYTONA USA Deluxe Demo WWW.exe',
    flatten: ['../DOC/English'],
  },
  {
    // The Game directory is the unpacked install. CLIENT.EXE LoadLibrary's
    // its renderer, sound and music DLLs from here, and Music\ keeps its tree.
    id: 'blood2_demo',
    root: 'Blood2-demoD3D/Game',
    exe: 'Client.exe',
  },
  {
    // The demo's own Wise installer, run in the emulator, wrote installed/ and
    // a disciple.ini naming every data directory by absolute path, so the tree
    // mounts back at C:\\Program Files\\Disciples Demo\\.
    id: 'disciples_demo',
    root: 'Disciples demo SW/installed',
    exe: 'exe/discipdm.exe',
    vfsRoot: 'c:\\program files\\disciples demo\\',
  },
  {
    // The WinZip self-extractor is the installed game itself (it even
    // carries InstallShield's DeIsL1.isu); unpack it first with
    //   unzip -q commandos-demo-SWonly.exe -d 'Commandos demo-SWonly/installed'
    id: 'commandos_demo',
    root: 'Commandos demo-SWonly/installed',
    exe: 'Comandos.exe',
  },
  {
    // The demo's own InstallShield setup, run in the emulator (stage 1 the
    // PackageForTheWeb wrapper with --capture-launch, stage 2 setup.exe and
    // _ins5576._mp), wrote this tree under C:\Program Files\Triumph Studios.
    id: 'age_of_wonders_demo',
    root: 'Age Of Wonders demo-SW/installed',
    exe: 'aow.exe',
    vfsRoot: 'c:\\program files\\triumph studios\\age of wonders beta demo\\',
  },
  {
    // Cryo's 1997 demo, run from its directory. HNM\ is a separate DOS
    // trailer (DOS4GW SHOWHN5A.EXE for DEMO3.UBB, DEMO*.BAT) and DSETUP\ the
    // DirectX installer; the Windows game reads neither.
    id: 'atlantis_demo',
    root: 'ATLANTIS demo SW',
    exe: 'ATLANTIS.EXE',
    exclude: ['HNM', 'DSETUP'],
  },
];

function walk(directory, relative = '', output = []) {
  const entries = fs.readdirSync(path.join(directory, relative), {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) walk(directory, name, output);
    else if (entry.isFile() && entry.name !== '.wine-assembly-browser.json') {
      output.push(name);
    }
  }
  return output;
}
function manifestFor(game, directory) {
  const executable = path.normalize(game.exe);
  const excluded = (game.exclude || []).map(dir => path.normalize(dir) + path.sep);
  const files = walk(directory).filter(relative =>
    path.normalize(relative) !== executable
      && !excluded.some(prefix => path.normalize(relative).startsWith(prefix))).map(relative => ({
    url: relative.split(path.sep).join('/'),
    vfsPath: (game.vfsRoot || 'c:\\') + relative.split(path.sep).join('\\'),
  }));
  for (const mediaRoot of game.media || []) {
    const mediaDirectory = path.join(directory, '..', mediaRoot);
    for (const relative of walk(mediaDirectory)) {
      const mediaPath = path.join(mediaRoot, relative);
      files.push({
        url: '../' + mediaPath.split(path.sep).join('/'),
        vfsPath: 'c:\\' + mediaPath.split(path.sep).join('\\'),
      });
    }
  }
  // Directories outside the game root whose files an installer copies flat
  // into the install directory (Daytona's DOC\English\thanks.txt).
  for (const flatRoot of game.flatten || []) {
    const flatDirectory = path.join(directory, flatRoot);
    for (const relative of walk(flatDirectory)) {
      const source = path.join(flatRoot, relative);
      files.push({
        url: source.split(path.sep).join('/'),
        vfsPath: 'c:\\' + relative.split(path.sep).join('\\'),
      });
    }
  }
  return `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`;
}

if (!fs.existsSync(CORPUS)) {
  throw new Error(`missing extracted corpus: ${path.relative(ROOT, CORPUS)}`);
}

for (const game of GAMES) {
  const directory = path.join(CORPUS, game.root);
  const executable = path.join(directory, game.exe);
  const destination = path.join(directory, '.wine-assembly-browser.json');
  if (!fs.existsSync(executable)) {
    throw new Error(`${game.id}: missing executable ${executable}`);
  }
  const wanted = manifestFor(game, directory);
  if (CHECK) {
    const actual = fs.existsSync(destination)
      ? fs.readFileSync(destination, 'utf8') : '';
    if (actual !== wanted) throw new Error(`${game.id}: stale browser manifest`);
    console.log(`OK ${game.id}`);
  } else {
    fs.writeFileSync(destination, wanted);
    const count = JSON.parse(wanted).files.length;
    console.log(`WROTE ${game.id} (${count} companion files)`);
  }
}

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(ROOT, 'test/binaries/win98-games-a-d');
const CHECK = process.argv.includes('--check');

const ONLY_ARG = process.argv.find(arg => arg.startsWith('--only='));
const ONLY = ONLY_ARG === undefined ? undefined : ONLY_ARG.slice(7);
if (ONLY === '') throw new Error('--only requires a nonempty game id');
const GAMES = [
  {
    // Original self-extracting ZIP payload; no installed-state fabrication.
    id: 'age_of_wonders2_demo',
    root: 'Age of Wonders2 demo-SW/extracted',
    exe: 'AoW2.exe',
    vfsRoot: 'c:\\aow2demo\\',
    exclude: ['.original-package.json', 'vcl50.bpl', 'vclx50.bpl', 'Ml42ND50.bpl'],
    defaultLoadMode: 'lazy',
  },
  {
    // Original CAB + authenticated installer loose overlays, no DX setup files.
    id: 'carmageddon_tdr2000_demo',
    root: 'Carmageddon TDR2000 demo-D3D-installed',
    exe: 'Tdr2000Demo.exe',
    exclude: ['Mss32.dll'], // Explicit app DLL, not a second VFS data mount.
    requiredExtensions: ['.txt', '.ini', '.cfg'],
    defaultLoadMode: 'lazy',
  },
  {
    // Original installed files mount at the paths used by the two installer seeds.
    id: 'croc2_demo',
    root: 'Croc2 demo-SW/installed',
    exe: 'croc2.exe',
    vfsRoot: 'c:\\program files\\fox\\croc 2 demo\\',
  },
  {
    // Original Wise installer output, unchanged game payload and configuration.
    id: 'diehard_nakatomi_demo',
    root: 'Diehard-nakatomi-demo-installed/program files/fox/die hard nakatomi plaza demo',
    exe: 'lithtech.exe',
    vfsRoot: 'c:\\program files\\fox\\die hard nakatomi plaza demo\\',
  },
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
  {
    // unzip -q smacdemo.exe, then keep only its programs\ directory: the
    // runnable game the InstallShield cabs beside it would install.
    id: 'alpha_centauri_demo',
    root: 'Alpha Centauri demo-SW/programs',
    exe: 'terran.exe',
  },
  {
    // The demo's InstallShield 5 setup, run in the emulator (16-bit launcher
    // with --tick-ms-per-batch=5, then _ins0576._mp), installed this tree to
    // C:\Games\FreeSpaceDemo.
    id: 'freespace_demo',
    root: 'Descent-Freespace demo-SW/installed',
    exe: 'fs.exe',
    vfsRoot: 'c:\\games\\freespacedemo\\',
  },
  {
    // The demo's InstallShield 3 setup, run in the emulator from the CD image
    // (--iso, --iso-exe=DKEDEMO\SETUP.EXE, --tick-ms-per-batch=5, then its
    // captured _ins0432._mp with the image still on D:), wrote this tree to
    // C:\DARKDEMO. The game reads its data from the CD at run time; the
    // registry entry mounts the CD from dark-earth.cue beside the image.
    id: 'dark_earth_demo',
    root: 'Dark_Earth_demo-NeedMountedCD-SW/installed',
    exe: 'dkedemo.exe',
    vfsRoot: 'c:\\darkdemo\\',
  },
  {
    // Anachronox demo (Ion Storm/Eidos 2001). An InstallShield 6 setup, whose
    // engine (ikernel.exe) is an out-of-process COM server the emulator does
    // not run, so the cabinets were unpacked with tools/is-cab.js (every file
    // MD5-checked) into C:\AnoxDemo, the setup's default, leaving out the
    // installer's own support DLLs. The engine opens ANOXDATA relative to the
    // working directory.
    id: 'anachronox_demo',
    root: 'Anachronox-Demo-SW-OpenGL-installed/anoxdemo',
    exe: 'anox.exe',
    vfsRoot: 'c:\\anoxdemo\\',
  },
  {
    // Braveheart demo (Red Lemon/Eidos 1999). Its InstallShield 5 Disk1,
    // installed headlessly like Drakan's, wrote this tree to
    // C:\Program Files\Red Lemon Studios\Braveheart Covermount Demo. Three
    // renderers ship side by side: brave.exe (Glide), bhd3d.exe (Direct3D)
    // and bhsoft.exe (software), the one the registry entry runs.
    id: 'braveheart_demo',
    root: 'braveheart-demo-Glide-installed/braveheart covermount demo',
    exe: 'bhsoft.exe',
    vfsRoot: 'c:\\program files\\red lemon studios\\braveheart covermount demo\\',
  },
  {
    // Drakan: Order of the Flame demo. Its InstallShield 5 Disk1, installed
    // headlessly (SETUP.EXE --capture-launch, then the captured _ins5176._mp
    // with --save-vfs-prefix='c:\program files'), wrote this tree to
    // C:\Program Files\Psygnosis\Drakan Demo; the engine finds its data
    // relative to drakan.exe, so the tree keeps that guest path.
    id: 'drakan_demo',
    root: 'DrakanOrderOfTheFlameDemoD3D-installed/drakan demo',
    exe: 'drakan.exe',
    vfsRoot: 'c:\\program files\\psygnosis\\drakan demo\\',
  },
  {
    // The demo's InstallShield 5 setup, run in the emulator (SETUP.EXE with
    // --capture-launch, then its _ins5176._mp), wrote this tree to
    // C:\Games\Descent3Demo. Its opengl32.dll is Microsoft's NT software GL
    // client; mounted, it would replace the emulator's own OpenGL, so it
    // stays out of the manifest.
    id: 'descent3_demo',
    root: 'Descent3 demo10-installed/installed/games/descent3demo',
    exe: 'main.exe',
    vfsRoot: 'c:\\games\\descent3demo\\',
    exclude: ['opengl32.dll'],
  },
  {
    // Activision's 1997 demo. Its InstallShield 3 setup ships the game tree
    // uncompressed in DATA\, which runs as is.
    id: 'dark_reign_demo',
    root: 'Dark Reign-SWonlyProbablyMaybeD3D/DATA',
    exe: 'DKReign.exe',
  },
  {
    // Max Design's 1998 demo: a RAR self-extractor whose contents are the
    // game tree itself (extracted with node-unrar-js; 7-Zip lacks the codec).
    id: 'cmr2_demo',
    // Codemasters' 2000 demo. Its InstallShield 6 setup needs ikernel.exe as an
    // out-of-process COM server, which the emulator does not run, so the tree
    // is the cabinet contents (node tools/is-cab.js <dir> --extract=extracted,
    // every file MD5-checked against its descriptor).
    root: 'Colin-Mcrae-Rally2-demo-D3D/extracted',
    exe: 'CMR2Demo.exe',
    vfsRoot: 'c:\\cmr2demo\\',
  },
  {
    id: 'anno1602_demo',
    root: 'Anno1602-demo-SW/extracted',
    exe: '1602.exe',
  },
  {
    // Ion Storm/Eidos 2000 demo. Its InstallShield 5 Disk1 (inside a WinZip
    // SFX), installed headlessly like Drakan's, wrote this tree to
    // C:\Program Files\Eidos Interactive\Daikatana Demo; the engine opens
    // ./data and ./dlls relative to the working directory.
    id: 'daikatana_demo',
    root: 'Daikatana demo-SW/installed',
    exe: 'daikatana.exe',
    vfsRoot: 'c:\\program files\\eidos interactive\\daikatana demo\\',
  },
  {
    // Silmarils' 1998 demo. The WinRAR SFX was unpacked with node-unrar-js
    // (7-Zip lacks the RAR codec), then the demo's own _setup.exe installed and
    // configured it in the emulator into C:\ASGHAN.DEM; the tree is that
    // install (the SFX payload plus _start.stp, _start.cdp and app.exe).
    id: 'asghan_demo',
    root: 'Asghan-demo-installed',
    exe: '_start.exe',
    vfsRoot: 'c:\\asghan.dem\\',
  },
  {
    // Reflections' 1999 demo. Its InstallShield 5 setup (16-bit SETUP.EXE ->
    // _ins5176._mp), run in the emulator, wrote this tree to
    // C:\Program Files\GT Interactive\Driver Demo.
    id: 'driver_demo',
    root: 'Driver-Demo-Glide-D3D/installed',
    exe: 'game.exe',
    vfsRoot: 'c:\\program files\\gt interactive\\driver demo\\',
  },
  {
    // Codemasters' 1998 CD demo, run from its SETUP\ directory as the CD's
    // autorun does. SETUPDIR\, the cabs and the InstallShield stubs are the
    // installer; the game reads GAME\, DEMO\ and INI\ beside GAME.EXE.
    id: 'colin_mcrae_rally_demo',
    root: 'ColinMcrae-Rally1-Demo/SETUP',
    exe: 'GAME.EXE',
    exclude: ['SETUPDIR'],
  },
  {
    // AvPDemo3.exe is a RAR 2.x self-extractor (7-Zip here has no RAR codec),
    // so it was run in the emulator itself, OK pressed, and the tree saved:
    //   node test/run.js --exe=<dir>/AvPDemo3.exe --batch-size=200000
    //     --input=50:keydown:13,53:keyup:13 --save-vfs=<out>
    // then every archive member (not windows\ or the SFX) copied to extracted\.
    id: 'avp_alien_demo',
    root: 'Alien vs Predator - Alien demo-D3D/extracted',
    exe: 'avp_alien_demo.exe',
  },
  {
    // Installed tree beside its InstallShield media: ship what the game
    // opens, not the installer, its cabinets or the logs a run writes.
    id: 'avp_marine_demo',
    root: 'Alien vs Predator-MarineDemo-D3D',
    exe: 'AvP_Marine_Demo.exe',
    exclude: ['data1.cab', '_sys1.cab', '_user1.cab', '_INST32I.EX_', '_ISDEL.EXE',
      '_SETUP.DLL', 'SETUP.EXE', 'SETUP.INI', 'setup.ins', 'setup.lid', 'setup.bmp',
      'DSETUP.DLL', 'DSETUP16.DLL', 'DSETUP32.DLL', 'layout.bin', 'os.dat', 'lang.dat',
      'DATA.TAG', 'LOGFILE.TXT', 'dx_error.log', 'ConsoleLog.txt', 'Marine Instructions'],
  },
  {
    // InstallShield 3 media (data.z). installed\ is what its own SETUP.EXE
    // wrote when run in the emulator: the 16-bit bootstrap captured with
    // --capture-launch, then its _ins0432._mp engine run with --vfs-tree and
    // --save-vfs, Next pressed through every page (c:\program files\interplay\
    // carmageddon ii demo). The game opens C:\DATA\... from its directory.
    id: 'carmageddon2_demo',
    root: 'Carmageddon2Demo-D3D-Glide/installed',
    exe: 'carma2_d3d.exe',
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
  // An exclude entry names a directory (everything under it) or one file.
  const excluded = (game.exclude || []).map(entry => path.normalize(entry));
  const files = walk(directory).filter(relative =>
    path.normalize(relative) !== executable
      && !excluded.some(entry => path.normalize(relative) === entry
        || path.normalize(relative).startsWith(entry + path.sep))).map(relative => ({
    url: relative.split(path.sep).join('/'),
    vfsPath: (game.vfsRoot || 'c:\\') + relative.split(path.sep).join('\\'),
    // Byte length: lets lib/app-files.js stream a large file with no HEAD.
    size: fs.statSync(path.join(directory, relative)).size,
    ...(game.defaultLoadMode ? {
      loadMode: (game.requiredExtensions || []).includes(path.extname(relative).toLowerCase())
        ? 'required' : game.defaultLoadMode,
    } : {}),
  }));
  for (const mediaRoot of game.media || []) {
    const mediaDirectory = path.join(directory, '..', mediaRoot);
    for (const relative of walk(mediaDirectory)) {
      const mediaPath = path.join(mediaRoot, relative);
      files.push({
        url: '../' + mediaPath.split(path.sep).join('/'),
        vfsPath: 'c:\\' + mediaPath.split(path.sep).join('\\'),
        size: fs.statSync(path.join(mediaDirectory, relative)).size,
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
        size: fs.statSync(path.join(flatDirectory, relative)).size,
      });
    }
  }
  return `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`;
}

if (ONLY && !GAMES.some(game => game.id === ONLY)) throw new Error(`unknown --only game: ${ONLY}`);

if (!fs.existsSync(CORPUS)) {
  throw new Error(`missing extracted corpus: ${path.relative(ROOT, CORPUS)}`);
}

for (const game of GAMES.filter(game => !ONLY || game.id === ONLY)) {
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
    // Guard the mutation itself: a caller's shell may continue after a failed
    // preflight. Missing/unreadable capacity information must also abort.
    const disk = fs.statfsSync(directory, { bigint: true });
    const available = disk.bavail * disk.bsize;
    if (available < 2n * 1024n ** 3n) {
      throw new Error(`${game.id}: disk floor 2GiB (${available} bytes available)`);
    }
    fs.writeFileSync(destination, wanted);
    const count = JSON.parse(wanted).files.length;
    console.log(`WROTE ${game.id} (${count} companion files)`);
  }
}

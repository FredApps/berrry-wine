#!/usr/bin/env node

'use strict';

// WinRAR 3.10 is a Win98-compatible GUI acceptance target. Its license allows
// redistribution of only the original unmodified installer, so this gate runs
// that hash-pinned local corpus artifact directly and never checks in extracted
// files.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PNG } = require('pngjs');
const { compileSrcWasm } = require('./compile-src');
const { APPS, DESKTOP_APPS, LOCAL_CANDIDATE_APPS } = require('../lib/apps');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(__dirname, 'run.js');
const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'candidate-corpus', 'manifest.json'), 'utf8'));
const WINRAR = path.join(__dirname, 'binaries', 'candidates',
  'winrar-310', 'wrar310.exe');
const INSTALLED_ROOT = path.join(__dirname, 'binaries', 'candidates',
  'winrar-310', 'installed');
const INSTALLED_WINRAR = path.join(INSTALLED_ROOT, 'WinRAR.exe');
const SHA1 = 'e7fbcc871245ef9eaf73f8c0dfb00f4b63456a91';

const winrarApp = APPS.winrar_310;
assert(winrarApp, 'installed WinRAR has a browser app registry entry');
assert(LOCAL_CANDIDATE_APPS.some(([id]) => id === 'winrar_310'),
  'installed WinRAR is visible on the localhost desktop and dropdown');
assert(!DESKTOP_APPS.some(([id]) => id === 'winrar_310'),
  'WinRAR is not published as a deployed app');
assert.strictEqual(winrarApp.exe,
  'test/binaries/candidates/winrar-310/installed/WinRAR.exe',
  'the launcher uses the installed GUI, not the self-extracting installer');
assert.strictEqual(winrarApp.requiredFiles, true,
  'WinRAR refuses a partial companion-file mount');
assert.strictEqual(winrarApp.preExtractIcon, false,
  'WinRAR derives its icon at runtime from the ignored executable');
assert(winrarApp.files.some(file => file.vfsPath === 'Formats\\ace.fmt'),
  'WinRAR mounts archive-format plugins in their original subdirectory');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(html.includes('<option value="winrar_310">WinRAR 3.10</option>'),
  'WinRAR has a concrete localhost dropdown option');

function peSubsystem(bytes) {
  assert(bytes.length >= 0x100 && bytes.toString('ascii', 0, 2) === 'MZ',
    'WinRAR package has a DOS/PE header');
  const pe = bytes.readUInt32LE(0x3c);
  assert(pe + 94 <= bytes.length && bytes.toString('binary', pe, pe + 4) === 'PE\0\0',
    'WinRAR package has a valid PE signature');
  return bytes.readUInt16LE(pe + 24 + 68);
}

function colorCount(png, rgb) {
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] === rgb[0] && png.data[i + 1] === rgb[1] &&
        png.data[i + 2] === rgb[2] && png.data[i + 3]) count++;
  }
  return count;
}

function colorCountInRect(png, rgb, left, top, right, bottom) {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] === rgb[0] && png.data[i + 1] === rgb[1] &&
          png.data[i + 2] === rgb[2] && png.data[i + 3]) count++;
    }
  }
  return count;
}

function rgbAt(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

function darkCountInRect(png, left, top, right, bottom) {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] < 100 && png.data[i + 1] < 100 &&
          png.data[i + 2] < 100 && png.data[i + 3]) count++;
    }
  }
  return count;
}

function saturatedCountInRect(png, left, top, right, bottom) {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 50 &&
          Math.max(r, g, b) > 100 && png.data[i + 3]) count++;
    }
  }
  return count;
}

function titleBlueCountInRect(png, left, top, right, bottom) {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (b > 100 && b - r > 30 && b - g > 20 && png.data[i + 3]) count++;
    }
  }
  return count;
}

(async () => {
  const candidate = MANIFEST.candidates.find(item => item.id === 'winrar-310');
  assert(candidate, 'WinRAR 3.10 has a candidate-corpus entry');
  assert.strictEqual(candidate.kind, 'GUI application',
    'WinRAR is classified separately from console candidates');
  assert.strictEqual(candidate.localOnly, true,
    'WinRAR remains an ignored local-only artifact');
  assert.deepStrictEqual(candidate.packages.map(pkg => [
    pkg.type, pkg.destination, pkg.sha1,
  ]), [['file', 'wrar310.exe', SHA1]],
  'WinRAR preserves the exact intact installer download and hash');
  assert.deepStrictEqual(candidate.postExtract, [{
    type: 'extractArchive', archive: 'wrar310.exe', into: 'installed',
  }], 'WinRAR preparation extracts the intact SFX into the launcher tree');

  if (!fs.existsSync(WINRAR)) {
    console.log('SKIP WinRAR candidate: fetch with node tools/fetch-candidate-corpus.js --id=winrar-310');
    return;
  }

  const bytes = fs.readFileSync(WINRAR);
  assert.strictEqual(bytes.length, 964587, 'WinRAR fixture has the pinned installer size');
  assert.strictEqual(crypto.createHash('sha1').update(bytes).digest('hex'), SHA1,
    'WinRAR fixture bytes match the pinned original installer');
  assert.strictEqual(peSubsystem(bytes), 2,
    'WinRAR is a Windows GUI executable, not a console-subsystem executable');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-winrar-'));
  const wasmPath = path.join(temp, 'candidate.wasm');
  const framePath = path.join(temp, 'winrar.png');
  const installedFramePath = path.join(temp, 'winrar-installed.png');
  const browseFramePath = path.join(temp, 'winrar-browse.png');
  const integrationFramePath = path.join(temp, 'winrar-integration.png');
  const rapidPagesFramePath = path.join(temp, 'winrar-rapid-pages.png');
  const mainFramePath = path.join(temp, 'winrar-main-after-settings.png');
  const commandsFramePath = path.join(temp, 'winrar-commands.png');
  const driveFramePath = path.join(temp, 'winrar-drive-menu.png');
  try {
    const wasm = compileSrcWasm();
    await WebAssembly.compile(wasm);
    fs.writeFileSync(wasmPath, wasm);

    const result = spawnSync('node', [
      RUN,
      `--exe=${WINRAR}`,
      `--wasm=${wasmPath}`,
      '--no-build',
      '--quiet-api',
      '--quiet-blocks',
      '--max-batches=120',
      '--batch-size=50000',
      `--png=${framePath}`,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.error) throw result.error;
    assert.strictEqual(result.status, 0,
      `WinRAR installer exited ${result.status}${result.signal ? ` (${result.signal})` : ''}\n${output.slice(-8000)}`);
    assert(!/UNIMPLEMENTED API:|\*\*\* CRASH|RuntimeError|LinkError/i.test(output),
      `WinRAR installer hit a compatibility failure\n${output.slice(-8000)}`);
    for (const marker of [
      '"WinRAR self-extracting archive"', '"WinRAR 3.10"',
      '"&Destination folder"', '"Install"', '"License"', '"Accept"',
    ]) {
      assert(output.includes(`[SetWindowText] ${marker}`),
        `WinRAR installer did not reach ${marker}\n${output.slice(-8000)}`);
    }
    assert(fs.existsSync(framePath), 'WinRAR installer did not produce a browser frame');

    const png = PNG.sync.read(fs.readFileSync(framePath));
    assert.strictEqual(`${png.width}x${png.height}`, '640x480',
      'WinRAR candidate uses the browser-sized Win98 desktop');
    // Prove the installer itself rendered. The amount of desktop teal is the
    // inverse of the correctly sized windows and changes whenever placement or
    // non-client metrics improve, so it is not evidence about their contents.
    // These deliberately roomy regions instead cover the active title bar,
    // destination edit, license text pane, and bottom command-button row.
    const titleBlue = titleBlueCountInRect(png, 60, 50, 600, 125);
    const destinationWhite = colorCountInRect(png, [255, 255, 255],
      70, 170, 530, 215);
    const licenseWhite = colorCountInRect(png, [255, 255, 255],
      70, 200, 590, 430);
    const licenseInk = darkCountInRect(png, 70, 200, 590, 430);
    const buttonGray = colorCountInRect(png, [192, 192, 192],
      220, 425, 450, 475);
    assert(titleBlue > 5000 && destinationWhite > 4000 &&
      licenseWhite > 75000 && licenseInk > 7000 && buttonGray > 5000,
      `WinRAR setup controls are not visibly rendered (${titleBlue} title pixels, ` +
        `${destinationWhite} destination pixels, ${licenseWhite} license-paper pixels, ` +
        `${licenseInk} license-ink pixels, ${buttonGray} button pixels)`);

    assert(fs.existsSync(INSTALLED_WINRAR),
      'prepare WinRAR before testing the dropdown: node tools/fetch-candidate-corpus.js --id=winrar-310 --prepare');
    const installed = spawnSync('node', [
      RUN,
      `--exe=${INSTALLED_WINRAR}`,
      '--vfs-include=**/*',
      `--wasm=${wasmPath}`,
      '--no-build',
      '--quiet-api',
      '--quiet-blocks',
      '--trace-api=EnableWindow,DestroyWindow,SystemParametersInfoA,' +
        'IShellFolder_EnumObjects,IEnumIDList_Next,' +
        'IShellFolder_GetAttributesOf,IShellFolder_GetDisplayNameOf',
      '--max-batches=120',
      '--batch-size=50000',
      `--input=1:wait-title:Please_register:2000,2:dlg-click:1,5:dump-windows:registration-closed,` +
        `10:mousedown:350:76,11:mouseup:350:76,20:png:${integrationFramePath},` +
        `22:mousedown:220:76,23:mouseup:220:76,` + // File list
        `24:mousedown:275:76,25:mouseup:275:76,` + // Viewer
        `26:mousedown:170:76,27:mouseup:170:76,` + // Paths
        `28:mousedown:120:76,29:mouseup:120:76,` + // Compression
        `32:png:${rapidPagesFramePath},40:dlg-click:2,` +
        `45:dump-windows:settings-closed,46:png:${mainFramePath},` +
        `50:mousedown:95:51,51:mouseup:95:51,` +
        `60:png:${commandsFramePath},70:mousedown:500:400,71:mouseup:500:400,` +
        `75:mousedown:42:51,76:mouseup:42:51,78:mousemove:100:91,` +
        `85:png:${driveFramePath},90:mousedown:500:400,91:mouseup:500:400`,
      `--png=${installedFramePath}`,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const installedOutput = `${installed.stdout || ''}${installed.stderr || ''}`;
    if (installed.error) throw installed.error;
    assert.strictEqual(installed.status, 0,
      `installed WinRAR exited ${installed.status}${installed.signal ? ` (${installed.signal})` : ''}\n${installedOutput.slice(-8000)}`);
    assert(!/UNIMPLEMENTED API:|\*\*\* CRASH|RuntimeError|LinkError/i.test(installedOutput),
      `installed WinRAR hit a compatibility failure\n${installedOutput.slice(-8000)}`);
    for (const [action, label] of [
      ['0x00000068', 'SPI_GETWHEELSCROLLLINES'],
      ['0x00000026', 'SPI_GETDRAGFULLWINDOWS'],
      ['0x0000001f', 'SPI_GETICONTITLELOGFONT'],
    ]) {
      assert(installedOutput.includes(`SystemParametersInfoA(${action},`),
        `WinRAR did not exercise ${label}\n${installedOutput.slice(-8000)}`);
    }
    assert(/SystemParametersInfoA\(0x0000001f, 0x0000005c,/i.test(installedOutput),
      `WinRAR did not issue its newer-sized ANSI icon-title LOGFONT query\n${installedOutput.slice(-8000)}`);
    assert(installedOutput.includes('[SetWindowText] "c:\\ - WinRAR (evaluation copy)"'),
      `installed WinRAR never reached its live file panel\n${installedOutput.slice(-8000)}`);
    assert(/IShellFolder_EnumObjects\(0x[0-9a-f]+, 0x00010003, 0x00000020, 0x[0-9a-f]+\)/i.test(installedOutput),
      `WinRAR did not request desktop SHCONTF_FOLDERS for its navigation control\n${installedOutput.slice(-8000)}`);
    const enumNextCalls = installedOutput.match(/IEnumIDList_Next\(/g) || [];
    const enumAttributeCalls = installedOutput.match(/IShellFolder_GetAttributesOf\(/g) || [];
    const enumDisplayCalls = installedOutput.match(/IShellFolder_GetDisplayNameOf\(/g) || [];
    assert(enumNextCalls.length >= 3 && enumAttributeCalls.length >= 2 && enumDisplayCalls.length >= 2,
      `WinRAR did not consume two enumerated desktop roots into visible navigation ` +
        `(${enumNextCalls.length} Next, ${enumAttributeCalls.length} attributes, ` +
        `${enumDisplayCalls.length} display-name calls)\n${installedOutput.slice(-8000)}`);
    const modalDisable = installedOutput.match(
      /\[API #[^\]]+\] EnableWindow\((0x[0-9a-f]+), 0x00000000\)/i);
    assert(modalDisable,
      `WinRAR COMCTL32 did not disable the property-sheet owner\n${installedOutput.slice(-8000)}`);
    const ownerEnablePattern = new RegExp(
      `\\[API #[^\\]]+\\] EnableWindow\\(${modalDisable[1]}, 0x00000001\\)`, 'i');
    assert(ownerEnablePattern.test(installedOutput),
      `WinRAR COMCTL32 did not re-enable the owner it disabled\n${installedOutput.slice(-8000)}`);
    assert(/\[input\] window:registration-closed .*enabled=false .*title="c:\\\\ - WinRAR \(evaluation copy\)"/.test(installedOutput),
      `closing WinRAR registration prematurely enabled the Settings owner\n${installedOutput.slice(-8000)}`);
    assert(/\[input\] window:settings-closed .*enabled=true .*title="c:\\\\ - WinRAR \(evaluation copy\)"/.test(installedOutput),
      `WinRAR owner remained disabled after Settings closed\n${installedOutput.slice(-8000)}`);
    for (const plugin of ['ace', 'arj', 'bz2', 'cab', 'gz', 'iso', 'lzh', 'tar', 'uue']) {
      assert(installedOutput.includes(`[LoadLibrary] ${plugin}.fmt loaded`),
        `installed WinRAR did not load ${plugin}.fmt\n${installedOutput.slice(-8000)}`);
    }
    assert(fs.existsSync(integrationFramePath),
      'WinRAR did not capture its Integration property page');
    const integrationPng = PNG.sync.read(fs.readFileSync(integrationFramePath));
    // This region contains Integration's shell-options group and Context menu
    // button. Before DS_SETFONT reached the native tab, COMCTL32 calculated
    // wider hit rectangles than the visible labels and the same click opened
    // Viewer's large white external-viewer edit instead.
    const integrationInk = darkCountInRect(integrationPng, 235, 225, 495, 315);
    const strayViewerWhite = colorCountInRect(integrationPng, [255, 255, 255],
      235, 225, 495, 315);
    assert(integrationInk > 1000 && strayViewerWhite < 1000,
      `visible Integration tab selected the wrong property page ` +
        `(${integrationInk} Integration pixels, ${strayViewerWhite} Viewer-edit pixels)`);
    const exposedPageWhite = colorCountInRect(integrationPng, [255, 255, 255],
      50, 87, 510, 91);
    assert(exposedPageWhite < 40,
      `WinRAR tab left its exposed property-page band white (${exposedPageWhite} white pixels)`);
    assert.deepStrictEqual(rgbAt(integrationPng, 25, 25), [128, 128, 128],
      'modal Settings paints the obscured WinRAR owner caption inactive');
    assert.deepStrictEqual(rgbAt(integrationPng, 42, 42), [0, 0, 128],
      'modal Settings paints its foreground caption active');
    assert(fs.existsSync(rapidPagesFramePath),
      'WinRAR did not capture rapid property-page switching');
    const rapidPagesPng = PNG.sync.read(fs.readFileSync(rapidPagesFramePath));
    // Compression owns no controls in this upper-right page area. Paths,
    // File list, or Viewer text here means a hidden page painted after the
    // final selection—the multi-page smear visible during rapid tab changes.
    const hiddenPageInk = darkCountInRect(rapidPagesPng, 270, 120, 490, 180);
    assert(hiddenPageInk < 30,
      `WinRAR rapid tab switching overpainted hidden pages (${hiddenPageInk} stale dark pixels)`);
    assert(fs.existsSync(mainFramePath),
      'WinRAR did not capture its main toolbar after Settings closed');
    const mainPng = PNG.sync.read(fs.readFileSync(mainFramePath));
    const toolbarColor = saturatedCountInRect(mainPng, 35, 65, 411, 120);
    assert(toolbarColor > 1000,
      `WinRAR toolbar was still blank after Settings closed (${toolbarColor} colored pixels)`);
    assert.deepStrictEqual(rgbAt(mainPng, 25, 25), [0, 0, 128],
      'closing Settings restores WinRAR main-window active caption');
    // WinRAR binds SHGFI_SYSICONINDEX as LVSIL_SMALL. Its first six visible
    // rows are files and row seven is the Formats directory: the old fake
    // HIMAGELIST=1 drew dark placeholders, while an incorrectly ordered strip
    // paints every file as a yellow folder.
    const fileFolderYellow = colorCountInRect(mainPng, [240, 192, 64],
      28, 170, 45, 266);
    const directoryYellow = colorCountInRect(mainPng, [240, 192, 64],
      28, 266, 45, 282);
    assert(fileFolderYellow < 5 && directoryYellow > 60,
      `WinRAR shell icons are misclassified (${fileFolderYellow} file-folder pixels, ${directoryYellow} directory pixels)`);
    assert(fs.existsSync(commandsFramePath),
      'WinRAR did not capture its Commands menu');
    const commandsPng = PNG.sync.read(fs.readFileSync(commandsFramePath));
    // Commands begins at x=61. Its longest label + accelerator requires about
    // 230px, so this strip lies beyond the former fixed 180px popup yet must
    // still be the menu's BTNFACE background rather than underlying toolbar.
    const widenedMenuGray = colorCountInRect(commandsPng, [192, 192, 192],
      245, 65, 288, 378);
    assert(widenedMenuGray > 9000,
      `WinRAR Commands menu remained clipped (${widenedMenuGray} gray extension pixels)`);
    assert(fs.existsSync(driveFramePath),
      'WinRAR did not capture its owner-drawn Change drive cascade');
    const drivePng = PNG.sync.read(fs.readFileSync(driveFramePath));
    // File > Change drive is rebuilt by WinRAR as two MF_OWNERDRAW items. The
    // cascade background alone is not evidence: before WM_MEASUREITEM and
    // WM_DRAWITEM dispatch it was a correctly sized but completely blank gray
    // box. Exclude its frame and require ink in both measured item rows.
    const cDriveInk = darkCountInRect(drivePng, 262, 86, 290, 101);
    const dDriveInk = darkCountInRect(drivePng, 262, 105, 290, 121);
    assert(cDriveInk > 20 && dDriveInk > 20,
      `WinRAR owner-drawn C:/D: rows stayed blank ` +
        `(${cDriveInk} first-row ink, ${dDriveInk} second-row ink)`);

    // Exercise WinRAR's real BROWSEINFOA caller rather than only the shell
    // dialog internals. The startup Settings sheet is already visible behind
    // the registration notice: select Paths, press its first Browse button,
    // and capture as soon as the shell-owned modal becomes visible.
    const browse = spawnSync('node', [
      RUN,
      `--exe=${INSTALLED_WINRAR}`,
      '--vfs-include=**/*',
      `--wasm=${wasmPath}`,
      '--no-build',
      '--quiet-api',
      '--quiet-blocks',
      '--trace-api=SHBrowseForFolderA',
      '--max-batches=120',
      '--batch-size=50000',
      `--input=1:wait-title:Please_register:2000,2:dlg-click:1,` +
        `10:mousedown:170:76,11:mouseup:170:76,20:dlg-click:103,` +
        `21:wait-title-snapshot:Browse_for_Folder:100:browse:${browseFramePath}`,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const browseOutput = `${browse.stdout || ''}${browse.stderr || ''}`;
    if (browse.error) throw browse.error;
    assert.strictEqual(browse.status, 0,
      `WinRAR folder-picker run exited ${browse.status}${browse.signal ? ` (${browse.signal})` : ''}\n${browseOutput.slice(-8000)}`);
    assert(!/UNIMPLEMENTED API:|\*\*\* CRASH|RuntimeError|LinkError/i.test(browseOutput),
      `WinRAR folder-picker run hit a compatibility failure\n${browseOutput.slice(-8000)}`);
    assert(browseOutput.includes('SHBrowseForFolderA('),
      `WinRAR did not call SHBrowseForFolderA from Paths > Browse\n${browseOutput.slice(-8000)}`);
    assert(browseOutput.includes('wait-title: matched "Browse for Folder"'),
      `WinRAR's folder picker never became visible\n${browseOutput.slice(-8000)}`);
    assert(fs.existsSync(browseFramePath), 'WinRAR folder picker did not produce a frame');
    const browsePng = PNG.sync.read(fs.readFileSync(browseFramePath));
    const browseGray = colorCount(browsePng, [192, 192, 192]);
    const browseWhite = colorCount(browsePng, [255, 255, 255]);
    const browseBlue = colorCount(browsePng, [0, 0, 128]);
    assert(browseGray > 30000 && browseWhite > 10000 && browseBlue > 500,
      `WinRAR folder picker is not visibly rendered (${browseGray} gray, ${browseWhite} white, ${browseBlue} blue pixels)`);

    const installedPng = PNG.sync.read(fs.readFileSync(installedFramePath));
    const installedTeal = colorCount(installedPng, [0, 128, 128]);
    const installedGray = colorCount(installedPng, [192, 192, 192]);
    const installedWhite = colorCount(installedPng, [255, 255, 255]);
    const installedBlue = colorCount(installedPng, [0, 0, 128]);
    assert(installedTeal > 150000 && installedGray > 35000 &&
      installedWhite > 35000 && installedBlue > 3000,
    `installed WinRAR file manager is not visibly rendered (${installedTeal} teal, ${installedGray} gray, ${installedWhite} white, ${installedBlue} blue)`);

    console.log(`PASS  WinRAR 3.10 installer and installed file manager render ` +
      `(${installedGray} gray, ${installedWhite} white, ${installedBlue} blue pixels; ` +
      `owner-draw drive rows ${cDriveInk}/${dDriveInk} ink)`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

'use strict';

// The default download policy for an app's companion files: which load at
// launch and which stay on the server and stream as the guest reads them.
//
// Both hosts call normalizeLazyFiles() on the same files[] (lib/browser-shell.js
// before wine.loadFiles, test/run.js before mounting), so a headless
// `--lazy-ranges` run audits exactly the decision the page makes.
//
// A lazy file is a read-only provider-backed VFS entry (lib/filesystem.js).
// Only ReadFile and read-only MapViewOfFile can park the guest on a cache
// miss; every other consumer needs the bytes in the same turn (_lread/_hread,
// DLL and resource loading, audio and GDI asset reads, writable mappings,
// writes). So the policy keeps eager what those consumers read, and every
// small file, and leaves streamed only large data the guest reads itself:
// archives, movies, levels.
//
// Rules, in order:
//   1. app.lazyFiles === false            -> every file eager (per-app opt-out)
//   2. a Win16 (NE) main image            -> every file eager (_lread cannot park)
//   3. a file that already says how it loads (loadMode, httpRange true/false,
//      eager:true, preloadRanges, decodeImage) -> left exactly as written
//   4. all sizes known and their total < APP_EAGER_BYTES -> every file eager
//      (Solitaire-sized apps load as before)
//   5. per file eager: an extension a synchronous consumer reads
//      (EAGER_EXTENSIONS; audio too when options.syncAudio is not false --
//      importsSyncAudio(exe bytes) decides it), a file smaller than
//      SMALL_FILE_BYTES, or a path app.persistFiles names (the guest writes it)
//   6. a file whose size is unknown (no `size`, no sizeOf answer) -> eager:
//      the small-file rule cannot be applied to it
//   7. otherwise streamed: {httpRange:true} -- one HEAD, then byte ranges as
//      the guest reads; a host without Range support gets the whole file.
(function () {
  const SMALL_FILE_BYTES = 256 * 1024;
  const APP_EAGER_BYTES = 16 * 1024 * 1024;

  // Read by something that cannot park on a cache miss: the PE/DLL loader
  // (images, codecs, plug-ins, type libraries), resource and font loading,
  // INI/registry-ish config, cursor/icon/bitmap-from-file, fonts and WinHelp.
  // AVI is not here: the 09a7f reader behind AVIFile and MCI avivideo parks a
  // missed chunk read and restarts the call, like ReadFile.
  const EAGER_EXTENSIONS = new Set([
    'exe', 'dll', 'drv', 'ocx', 'ax', 'acm', 'cpl', 'vxd', 'asi', 'm3d', 'flt', 'tlb', 'olb',
    'ini', 'inf', 'cfg', 'reg',
    'bmp', 'dib', 'ico', 'cur', 'ani',
    'ttf', 'ttc', 'fon', 'fnt',
    'hlp', 'cnt', 'chm',
    // AoE II's EBUEula.dll hands EULA.RTF to a reader that cannot park.
    'rtf',
  ]);
  // Audio is eager only for an app that can hand a file to a synchronous
  // WINMM consumer: PlaySound/sndPlaySound read the file in one turn, and the
  // MCI sequencer/waveaudio devices read it in JS. mmio refills park, so an
  // app that plays through mmio, Miles or its own ReadFile streams its audio:
  // Pirates! keeps 310 MB of .wav that way, Caesar III its mmio samples.
  const AUDIO_EXTENSIONS = new Set(['wav', 'mid', 'midi', 'rmi']);
  const SYNC_AUDIO_IMPORTS = [
    'PlaySoundA', 'PlaySoundW', 'sndPlaySoundA', 'sndPlaySoundW',
    'mciSendStringA', 'mciSendStringW', 'mciSendCommandA', 'mciSendCommandW',
  ];

  // Whether a PE names any synchronous WINMM file consumer: the import
  // table and GetProcAddress literals both leave the ASCII name in the file.
  function importsSyncAudio(bytes) {
    if (!bytes || typeof bytes.length !== 'number') return true;
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const needles = SYNC_AUDIO_IMPORTS.map(name => Array.from(name, ch => ch.charCodeAt(0)));
    const firsts = new Set(needles.map(n => n[0]));
    for (let i = 0; i < view.length; i++) {
      if (!firsts.has(view[i])) continue;
      for (const needle of needles) {
        if (needle[0] !== view[i] || i + needle.length >= view.length) continue;
        let k = 1;
        while (k < needle.length && view[i + k] === needle[k]) k++;
        // Whole name: the next byte ends the string (NUL), so PlaySoundA does
        // not match inside a longer identifier.
        if (k === needle.length && view[i + k] === 0) return true;
      }
    }
    return false;
  }

  function fileUrl(file) {
    return typeof file === 'string' ? file : (file && file.url) || '';
  }

  function extensionOf(url) {
    const leaf = String(url).replace(/[?#].*$/, '').replace(/^.*[\\/]/, '');
    const dot = leaf.lastIndexOf('.');
    return dot < 0 ? '' : leaf.slice(dot + 1).toLowerCase();
  }

  function vfsPathsOf(file) {
    if (typeof file === 'string') return ['c:\\' + file.replace(/^.*[\\/]/, '').toLowerCase()];
    if (Array.isArray(file.vfsPaths)) return file.vfsPaths.map(normalizePath);
    if (file.vfsPath) return [normalizePath(file.vfsPath)];
    return ['c:\\' + fileUrl(file).replace(/^.*[\\/]/, '').toLowerCase()];
  }

  function normalizePath(path) {
    let p = String(path || '').toLowerCase().replace(/\//g, '\\');
    if (!/^[a-z]:/.test(p)) p = 'c:\\' + p.replace(/^\\+/, '');
    return p;
  }

  // Same glob shape as lib/vfs-persistence.js persistFiles.
  function patternRegex(pattern) {
    const escaped = normalizePath(pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp('^' + escaped + '$');
  }

  function declaresLoading(file) {
    return typeof file === 'object' && file !== null && (
      file.loadMode !== undefined || file.httpRange !== undefined || file.eager === true ||
      file.preloadRanges !== undefined || file.decodeImage);
  }

  function sizeFor(file, sizeOf) {
    if (typeof file === 'object' && file && Number.isSafeInteger(file.size) && file.size >= 0) return file.size;
    if (typeof sizeOf === 'function') {
      const size = sizeOf(fileUrl(file), file);
      if (Number.isSafeInteger(size) && size >= 0) return size;
    }
    return null;
  }

  // Returns { files, summary }. `files` is a new array; entries left eager are
  // the original objects, lazy ones are shallow copies. Never mutates `app`.
  function normalizeLazyFiles(app, files, options = {}) {
    const list = Array.isArray(files) ? files : [];
    const summary = {
      policy: 'lazy', eagerFiles: 0, lazyFiles: 0, eagerBytes: 0, lazyBytes: 0, unknownSizes: 0,
    };
    const finish = (out, policy) => {
      summary.policy = policy;
      for (let i = 0; i < out.length; i++) {
        const size = sizeFor(out[i], options.sizeOf);
        const lazy = typeof out[i] === 'object' && out[i] &&
          (out[i].loadMode === 'lazy' || out[i].loadMode === 'background' ||
           (out[i].httpRange === true && out[i].loadMode !== 'required'));
        if (lazy) { summary.lazyFiles++; summary.lazyBytes += size || 0; }
        else { summary.eagerFiles++; summary.eagerBytes += size || 0; }
        if (size === null) summary.unknownSizes++;
      }
      return { files: out, summary };
    };
    if (app && app.lazyFiles === false) return finish(list.slice(), 'eager: app.lazyFiles false');
    if (options.isWin16) return finish(list.slice(), 'eager: Win16 image');

    const sizes = list.map(file => sizeFor(file, options.sizeOf));
    if (sizes.every(size => size !== null)) {
      const total = sizes.reduce((sum, size) => sum + size, 0);
      if (total < APP_EAGER_BYTES) return finish(list.slice(), 'eager: small app');
    }
    const persist = (app && Array.isArray(app.persistFiles) ? app.persistFiles : []).map(patternRegex);
    const out = list.map((file, i) => {
      if (!fileUrl(file) || declaresLoading(file)) return file;
      const size = sizes[i];
      // Unknown size: eager. Without a size the small-file rule cannot apply,
      // and streaming a small file a synchronous consumer reads is a hang --
      // AoE II's EULA.RTF (an unsized hand-written entry) went black that way.
      // A file streams only when its size says it is large.
      if (size === null) return file;
      const ext = extensionOf(fileUrl(file));
      if (EAGER_EXTENSIONS.has(ext)) return file;
      if (AUDIO_EXTENSIONS.has(ext) && options.syncAudio !== false) return file;
      if (size !== null && size < SMALL_FILE_BYTES) return file;
      if (persist.length && vfsPathsOf(file).some(path => persist.some(re => re.test(path)))) return file;
      // httpRange, not a sized loadMode 'lazy': a sized entry refuses to fall
      // back when the host answers a Range request with 200, which a plain
      // static server does -- the launch then stalls on "Download problem".
      // httpRange probes with one HEAD and loads the whole file from a host
      // without ranges. Only the large data files get here, so the HEADs are
      // few (31 of Carmageddon 2's 1605 files).
      const base = typeof file === 'string' ? { url: file } : { ...file };
      return { ...base, httpRange: true };
    });
    return finish(out, 'lazy');
  }

  const api = {
    SMALL_FILE_BYTES,
    APP_EAGER_BYTES,
    EAGER_EXTENSIONS,
    AUDIO_EXTENSIONS,
    SYNC_AUDIO_IMPORTS,
    importsSyncAudio,
    normalizeLazyFiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.appFiles = api;
})();

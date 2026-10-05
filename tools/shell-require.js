// Run a small Node-style tool inside a bare engine shell -- JavaScriptCore's
// `jsc`, V8's `d8`, SpiderMonkey's `js` -- with no Node underneath.
//
//   jsc tools/shell-require.js -- tools/bench-loops.js --stub-host --wasm=...
//   d8  tools/shell-require.js -- tools/bench-loops.js --stub-host --wasm=...
//   js  tools/shell-require.js tools/bench-loops.js --stub-host --wasm=...
//
// Run it from the repository root: every path is resolved against the shell's
// working directory, which the shells cannot report.
//
// WHY. A number measured in Node is a V8 number. The question behind
// tools/build-dispatch-variant.js is what JavaScriptCore does -- iOS Safari is
// the engine without wasm tail calls -- and the macOS system `jsc` is that
// engine's own shell. This supplies exactly the slice of Node the benchmark
// tools use (CommonJS require, fs reads, path, os, process.argv/env/hrtime/
// exit, console) and throws, by name, on anything else rather than faking it.
//
// NOT supported: native modules, child_process, writes, directory listing. A
// tool that needs them is not a shell tool; run it in Node.

// The shell's own argument list. Read at top level: inside the function below,
// `arguments` would be that function's.
var SHELL_ARGS = typeof scriptArgs !== 'undefined' ? Array.from(scriptArgs)
  : (typeof arguments !== 'undefined' ? Array.from(arguments) : []);

(function () {
  const G = globalThis;
  const argv = SHELL_ARGS;
  const engine = typeof preciseTime === 'function' ? 'jsc'
    : (typeof os === 'object' && os && os.file ? 'sm' : 'd8');

  const readText = p => {
    if (engine === 'sm') return os.file.readFile(p);
    if (engine === 'jsc') return readFile(p);
    return read(p);
  };
  const readBytes = p => {
    if (engine === 'sm') return os.file.readFile(p, 'binary');
    if (engine === 'jsc') return readFile(p, 'binary');
    return new Uint8Array(readbuffer(p));
  };
  const nowNs = () => engine === 'jsc'
    ? BigInt(Math.round(preciseTime() * 1e9))
    : BigInt(Math.round(performance.now() * 1e6));
  const unsupported = what => () => { throw new Error(`shell-require: ${what} is not available in a shell`); };

  // Paths stay RELATIVE to the working directory, normalized; there is no cwd
  // to make them absolute against.
  const normalize = p => {
    const abs = p.startsWith('/');
    const out = [];
    for (const part of p.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
      else if (part === '..' && abs) continue;
      else out.push(part);
    }
    return (abs ? '/' : '') + (out.join('/') || (abs ? '' : '.'));
  };
  const pathMod = {
    sep: '/',
    join: (...parts) => normalize(parts.filter(x => x !== '').join('/')),
    resolve: (...parts) => {
      let p = '';
      for (const part of parts) p = part.startsWith('/') ? part : (p ? `${p}/${part}` : part);
      return normalize(p);
    },
    dirname: p => { const n = normalize(p); const i = n.lastIndexOf('/'); return i < 0 ? '.' : (n.slice(0, i) || '/'); },
    basename: (p, ext) => { const b = normalize(p).split('/').pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
    extname: p => { const b = normalize(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
    relative: (from, to) => {
      const f = normalize(from), t = normalize(to);
      return f === '.' ? t : (t.startsWith(`${f}/`) ? t.slice(f.length + 1) : t);
    },
  };
  const exists = p => { try { readBytes(p); return true; } catch (_) { return false; } };
  const fsMod = {
    readFileSync: (p, enc) => (enc ? readText(p) : readBytes(p)),
    existsSync: exists,
    statSync: unsupported('fs.statSync'),
    readdirSync: unsupported('fs.readdirSync'),
    writeFileSync: unsupported('fs.writeFileSync'),
  };
  const osMod = { loadavg: () => [0, 0, 0], tmpdir: () => '/tmp', cpus: () => [] };
  const builtins = { fs: fsMod, path: pathMod, os: osMod,
    child_process: { execSync: unsupported('child_process.execSync'),
      execFileSync: unsupported('child_process.execFileSync') } };

  const say = (...a) => print(a.map(x => typeof x === 'string' ? x : String(x)).join(' '));
  G.console = { log: say, error: say, warn: say, info: say };
  G.process = {
    argv: ['shell', 'shell'],
    env: {},
    versions: {},
    platform: engine,
    exit: code => { if (typeof quit === 'function') quit(code | 0); throw new Error(`exit ${code}`); },
    hrtime: { bigint: nowNs },
    stdout: { write: s => { say(String(s).replace(/\n$/, '')); return true; } },
  };

  const cache = new Map();
  function load(file, isMain) {
    const key = normalize(file);
    if (cache.has(key)) return cache.get(key).exports;
    const src = readText(key).replace(/^#!.*\n/, '\n');
    const module = { exports: {}, filename: key };
    cache.set(key, module);
    const dir = pathMod.dirname(key);
    const req = spec => {
      if (builtins[spec]) return builtins[spec];
      let p = spec.startsWith('.') ? pathMod.join(dir, spec) : spec;
      if (!p.endsWith('.js') && !exists(p) && exists(`${p}.js`)) p = `${p}.js`;
      if (!exists(p)) throw new Error(`shell-require: cannot find module '${spec}' from ${key}`);
      return load(p, false);
    };
    if (isMain) req.main = module;
    else req.main = null;
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
      module, module.exports, req, dir, key);
    return module.exports;
  }

  if (!argv.length) throw new Error('usage: <shell> tools/shell-require.js -- <script.js> [args...]');
  const [script, ...rest] = argv;
  G.process.argv = ['shell', script, ...rest];
  load(script, true);
})();

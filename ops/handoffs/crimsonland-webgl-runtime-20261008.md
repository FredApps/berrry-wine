# Crimsonland WebGL runtime: splash verified, Tutorial not reached

Run `scratch/runs/20261008T0026Z-crimsonland-webgl-runtime` retains the exact
reference source `f62ab3c9f1223ab47cf623470f6343d508257878`, module
`4dc5ac2c477c71c64a42530562e4cf51e145bd966232e15330acfc01753d54de`, original
EXE `93cdcdc872c836e75122e3a1d41312c74761cf4736181d3541521e82f6cb2031`,
530 source/module/media pins, and explicitly named runtime harness overlay.
The immutable 0020 preparation remains unchanged. No native build or software
qualification was repeated. Runtime archive SHA is
`d5b52fc3829fbbc8e3ec2f085bdd55b074eda4bc55a7da6152577683f1b656c5`.

Actual `game-check.png` shows the Reflexive publisher splash. Its JSON verifies
matching live host and owning render Worker `api: neutral, backend: webgl`.
Chrome was `151.0.7922.108`.
Ordinary Enter held 750 ms on that reviewed splash was followed by two console
ExitProcess(0) lines at 00:32:19.178 and desktop in `main-menu.png`. No fault
callback, guest exception cause, or causal role of Enter was established.
Tutorial, its hover caption, terrain movement, combat, FPS, and audio remain
unqualified. No before/held/after gameplay frames exist because gameplay was
never reached. Next work should investigate this bounded original startup exit;
do not repeat software qualification or assume the older failure's cause.

Root 00:25:14 grant permitted transfer240/browser300/cleanup90 after Antara's
actual release. Independent old-box checks at 00:27:31 found Antara PIDs
42599/42621 absent, no Chrome, baseline sockets, and 49.52 GB free. Old TTL
00:36:50 could not fit 630 seconds plus margin. Fresh no-env `bx_mhxqmemj`
was created at 00:27:36, expiry 00:57:36, with independently installed
Puppeteer25.7.0. Remote HTTP/hash/controls/backend-negative preflight passed.
One actual browser, driver19243/Chrome19255, ran 00:28:55–00:32:38 under the
unchanged 00:33:55 guard. Ordinary quit closed browser/server, Chrome exit0,
streams0. Cleanup contains nine asset errors, including harness's initial
wrong-app requests and missing optional paths; do not report errors0.
Independent 00:32:58 checks found both PIDs absent, no Chrome, exact socket
baseline, unchanged 530 runtime pins and all 26 copied capture files matching
SHA. Only this worker's prefix/tools were removed after durable copy. Fresh box
stop completed 00:33:01.627. Existing old box and other workers were untouched.

Harness limitations and concrete corrections:

- The prepared toolbar selector lacks Crimsonland. `page.select` silently
  returned no match, and toolbar Launch started default Notepad. Same guarded
  browser recovered using the existing declared `?app=crimsonland` deep link.
  Committed browser helper now starts on that route. No production source changed.
- Actual launcher Play was at page322,295. The historical312,135 restriction was
  invalid here. The committed helper requires a reviewed screenshot showing the
  original visible native launcher and validates current page coordinate bounds.
- Auxiliary Puppeteer connections defaulted to 800×600, making the first click
  ineffective. The corrected ordinary launcher click restored1024×768 and used
  `defaultViewport:null`. Enter before that click did not dismiss the launcher.
  Auxiliary scripts/receipts are retained; stale launcher receipt SHA is explicitly
  corrected in `receipt-corrections.json`. These operations bypassed the initial
  harness's obsolete coordinate restriction, without guest writes or forced returns.
- Game click default is750ms; native launcher default100ms; explicit `holdMs`
  accepts integers50..5000 and reserves20seconds after hold. Release is attempted
  after down/hold errors, preserving both primary and release errors. Preflight
  tests cover bounds, defaults, deadline reserve and failure releases.

The runtime archive contains the actually executed harness; later direct-route
and launcher-review corrections are retained separately as `findings.patch` and
`final-source/`. They were syntax checked, not browser rerun. Result is published
last with contained artifact hashes. Worker commits only explicit own helper and
handoff paths; root integrates/pushes main. No further remote/browser run granted
or performed by this phase.

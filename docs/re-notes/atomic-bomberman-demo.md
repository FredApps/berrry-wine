# Atomic Bomberman alpha demo

## Package

The tested April 7, 1997 alpha is the ready-to-run `BMANDEMO` tree from the
local Windows 98 A-D compatibility archive documented in `sources.md`. That
selected package contains no setup program, cabinet, or self-extractor, so
launching `_BOMB.EXE` does not bypass an available installer. The package and
all gameplay files stay local and gitignored.

Pinned SHA-256 values:

- `_BOMB.EXE`: `0ff14a352d6626660ceb66ea0e6743cd33c457e754cfd5705120bacae0530638`
- `LEVELS.DAT`: `7f647eb426f93799e190b5697bec20c81d350cc5cc23b0adc9a29e2d814ad796`
- `README.BM`: `8cf26bf5541592dae04769eb3e50a90b506214dd1941ab84b15f445faadf3433`

The bundled readme describes the release as unsupported and says all rights
are reserved. It grants no redistribution permission, so neither the loose
tree nor the executable belongs in a public deployment.

## Gameplay route

`test/test-atomic-bomberman-gameplay.js` launches the registered browser app
in headless Chromium. It waits for each publisher logo to render, skips it,
and synchronizes on the title, main menu, input selection, options, and arena
frames. Four Enter presses select
Start Regular Game, keyboard input, the default level options, and the match.

The acceptance then holds Right, presses Space, and captures the arena before
movement, after movement, with a placed bomb, and during its explosion. It
requires the game to remain live, rejects browser/runtime compatibility
failures, and checks rich arena pixels, visible movement, bomb placement, and
explosion colors. Captures are written to
`build/local-candidate-smoke/atomic-bomberman/`.

Run explicitly with:

```bash
node test/test-atomic-bomberman-gameplay.js
```

## June 1997 public demo (`atomic_bomberman_june_demo`)

archive.org item `BOMBDEMO` (`ATOMDEMO.zip`) is the public demo, "SECOND
Alpha Release - 06/02/97": `BM95DEMO.EXE`, 25 MB installed. It is an
InstallShield 3 setup; `node tools/install-atomic-bomberman-demo.js` fetches
the zip (or takes `--zip=`), checks its SHA-256, and extracts `DATA.Z` with
`tools/is3-extract.js` into
`test/binaries/win98-games-a-d/Atomic Bomberman Demo-archive/installed/`
(gitignored). Its licence allows personal copies only, so it stays local.

- `ATOMDEMO.zip`: `ed5f2fd64e2b935ad4523a3183ebbbb23216cc56108eec1d13acc8a796110055`
- `BM95DEMO.EXE`: `6133d5aa74df524373501028548fa3e9b28798c118bfa379dc3ad3afba1eba71`

It is a Watcom build (sections `BEGTEXT`/`DGROUP`, so `--section=.text`
finds nothing) with rdtsc profiling hooks around every function; a function
entry is the `inc [counter]` after the previous `ret`, not a `push ebp`.

On a present-day calendar it draws "Software expired. Contact Interplay." over
the game. The registry's `wallClock: '1997-07-01T12:00:00Z'` fixes it:
`test/run.js` pins the calendar there (deterministic, like
`--wall-clock-ms`), and the browser moves the real clock back a whole number
of days, keeping the real time of day. Pinning an *instant* in the browser
would break network play: the node id below is `rand()` seeded by
`srand(time())` (`0x4091b8`), so two players pinned to one second draw the
same id.

## Network play (IPX)

Menu: Start Game / Start Network Game / Join Network Game / Options / ...
The socket opens only when a network item is picked, which is why the
registry `lan` block is `onDemand`.

Calls: `socket(AF_IPX=6, SOCK_DGRAM, 1000)`, `bind` (14-byte SOCKADDR_IPX),
`getsockname`, `SO_REUSEADDR` + `SO_BROADCAST`, `FIONBIO`, then polling:
`ioctlsocket(FIONREAD)` and, when nonzero, `recvfrom(len 0x206)`. Everything
goes to socket 0x6446 (25670), the server's announcements to node FF×6.
`src/09d-winsock.wat` maps it onto room UDP: node `00 00 a b c d` is the room
address, the socket number is the port.

Packet (after the ring header `[seq u32][len u16]`): `+0` version 0x5344
("Network Packet Version: 21316"), `+2` length, `+4` sender node id, `+8`
message type (the handler is `call [0x44db60 + type*4]`, `0x407823`), `+0xc`
target node id. Types seen: 0x44 server announce (59 B, carries the node
name from `NODENAME.INI`), 0x03 join request (61 B), 0x47 join reply (20 B).

- Node id: `[0x44ff0e]`, drawn by `rand()` until nonzero (`0x405ea7`).
  `0x407660` drops every packet whose sender id equals ours: two machines with
  one id each think the other's packets are their own echo, and the join list
  stays empty.
- Receive ring: 64 slots of 0x206 at `[0x44e398]`, write index `[0x44e394]`,
  read index `[0x44e390]`, advanced `(i+1) % 64` (`0x427ac0`). The consumer
  (`0x427624`) receives up to 64 datagrams per call (`0x42768b`..`0x427745`),
  then pops one. Receiving exactly 64 laps the ring and it reads as empty, so
  the game depends on a small socket backlog; the switch holds 32 datagrams
  per socket (`$VSOCK_DGRAM_MAX`).
- Join (`0x4204d5`): sends a join request on every pass of a loop that waits
  up to 1000 ms (`timeGetTime`) for `[0x44fe44]` (the server's id, set by the
  0x47 handler at `0x4064b3`), calling only sendto, FIONREAD and the clock,
  never a message pump. On timeout: "NOTE! Unable to obtain base offset"
  (MESSAGES.TXT 100). This is why FIONREAD has to pump the wire.

Headless two-process route (lockstep, one batch per round; a 10-batch round is
longer than the join's 1000 ms, which is 5 batches at the default clock, so
the reply always lands too late):

- both: 900 batches, Enter, 100, Enter, 100 → main menu;
- server: Down, 30, Enter → "Client slot" list;
- joiner: Down, 20, Down, 30, Enter → "Available net games"; ~400 batches
  later it lists `'Bombs Ahoy' (15992)`; Enter joins ("Joined... waiting for
  server to start");
- server: Enter three times, ~300 batches apart → both in the arena.
- Give the joiner a different `--wall-clock-ms` than the server, or both draw
  one node id. Hold keys for exactly one batch: three batches trigger the
  game's key repeat and one Down moves the menu cursor two items.
- `test/test-atomic-bomberman-vlan-gameplay.js` runs exactly this route
  (~75 s) and checks the announce, join request, join reply and both in-match
  streams on `--trace-net`. It SKIPs when the demo is not installed.
- The datagram queue also has a byte bound (`$VSOCK_DGRAM_RX_CAP`, 64 KB).
  It was 16 KB, the stream ring size, at first, and that dropped enough of
  Quake II's ~1400-byte signon burst that `test-quake2-vlan-gameplay.js`'s
  client never entered the world. Run that test on any change to the queue.

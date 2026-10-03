# Persistent coordinator preparation

The new host is a clean default-size ASCII box with `ttlSeconds: null`, snapshots
enabled and `noEnv: true`. No account environment, agent logins, Telegram token,
or repository credentials are implicitly inherited. Creation request, idempotency
key and private receipt live under ignored `scratch/ops-new-box-*` files.
`node ops/hosting/ascii.js create` creates only that configuration and refuses a second creation
when a receipt exists. After an ambiguous API failure, reconcile the account's
box list before retrying, using the same idempotency key.

Use `node ops/hosting/ascii.js list` and `node ops/hosting/ascii.js inspect bx_ID`
for sanitized account inventory. All preparation scripts use JavaScript.
`node ops/hosting/ascii.js prepare bx_ID` is restricted to the box recorded in
the creation receipt. It inspects tools and capacity and idempotently stages
private directories plus the disabled service template; it does not start work.

## Preparation and cutover

1. Confirm the new box identity and SSH host key from the authenticated API.
2. Inventory its OS, tools, disk and privileges; create a private project home.
3. Snapshot the local Git history, dirty tracked changes and approved untracked
   project files. Pin hashes and record files that change during copying. Keep
   the original worktree; do not copy all of the home directory or `.env` files.
4. Copy only the fixtures/artifacts needed for initial dashboard and work.
   Transfer credentials separately with restricted permissions. Reauthenticate
   Codex on the new host; do not assume a live local process can be migrated.
5. Validate the dashboard on loopback. The included systemd unit is a template,
   not an installed or enabled service. Confirm user, executable and repo paths.
6. Before public exposure, implement an explicitly configured public HTTPS
   origin and authentication covering HTTP routes and WebSocket upgrades. Keep
   port 8098 on loopback. Never rewrite arbitrary browser Origins to bypass the
   current origin checks. Password hashes belong outside Git. Test rejected
   requests, logins, task writes, terminal tickets and WebSocket authentication.
7. Request checkpoint handoffs from the old coordinator/workers. Move ownership
   after evidence and active processes are reconciled, then register new pane
   IDs/PIDs. Start one remote orchestrator and verify one bounded task.
8. Stop the local Telegram poller before moving its pairing/update/reply/chat
   state and starting the remote poller. Exactly one instance may own updates.
9. Verify crash recovery and reboot, then switch the public endpoint. Retain
   the local copy and audit artifacts for rollback.

The benchmark ASCII box remains separate. A provider `idle` label is not evidence
that SSH workloads have stopped. Existing service/process ownership still applies.

## Private snapshot

`node ops/hosting/snapshot.js /private/tmp/wine-assembly-migration-DATE` creates a
new private directory containing a Git bundle, dirty-work patch, source snapshot,
dashboard images/run metadata and project-specific Claude/Codex memories. Large
scratch, build, fixture and download trees are compressed separately to fit the
new box. The manifest records SHA-256 hashes and any source files that changed
during capture. Originals remain local. This is a checkpoint, not a claim that
unfinished emulator changes passed review.

Copy the snapshot over host-key-pinned SSH, then run
`node ops/hosting/verify-snapshot.js /path/to/private/snapshot` on the destination.
Clone `repository.bundle`, overlay `worktree/`, and preserve `manifest.missing`
deletions when reconstructing the source state. Disable inherited terminal
registrations until destination processes have their own confirmed identities.
Extract large archives selectively after checking free disk; never blindly
expand every archive onto a smaller disk. The live worktree already contains
dashboard images and small metadata, while raw historical evidence is archived.

Memories are private transfer data, not repository content. Keep their originals
in the private snapshot. On Linux, adapt Mac-specific paths/tool locations before
installing project memory: `~/.codex/memories/` and Claude's project memory folder
for `/home/user/wine-assembly`. Preserve required project rules in `CLAUDE.md` and
`AGENTS.md`. Account credentials, global home directories, unrelated memories and
raw session histories are not imported; task continuity comes from the frozen
handoffs, task ledger, messageboard and selected project memory.

SSH authorization uses `node ops/hosting/ascii.js authorize bx_ID` with the local
dedicated `scratch/ops-migration-key.pub`; the private key is never exported.

## Public HTTPS dashboard

Keep `wine-ops.service` on loopback port 8098. `wine-ops-public.service` exposes
only the password gateway on 8099. Its private configuration is
`~/.config/wine-ops/access.json` (0600): `origin` is the exact public HTTPS origin,
`salt` is 16 random bytes in hex, `passwordHash` is Node scrypt(password, salt, 32)
in hex, and `sessionKey` is 32 random bytes in hex. No plaintext password is kept
on the server. Rotate `sessionKey` to revoke existing browser sessions.

The gateway validates Host and browser Origin before translating an authenticated
request to the loopback backend. Authentication covers every page, API, artifact
and WebSocket upgrade. Writes require the exact public Origin. The login cookie
is Secure, HttpOnly, SameSite=Strict and expires after eight hours; restarting the
service preserves signed sessions, rotating the key revokes them. Login attempts
are rate limited. Only then run `host 8099 --public --title "Wine Ops"` to publish
the provider's TLS route. Port 8098 must never be hosted or publicly bound.

Test with `node --test ops/hosting/public-server.test.js`. After deployment,
check the external HTTPS login, unauthenticated API denial, authenticated state,
and a terminal upgrade. The public route is intentionally ungated at the provider
layer because the gateway supplies the password login; no token-bearing URL is
needed. [Provider HTTPS hosting documentation](https://docs.boat.dev/hosting).

Provider lifecycle documentation: [create sandbox](https://docs.boat.dev/api/reference/sandboxes/create-sandbox).

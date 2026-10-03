# Hosting inventory — 2026-10-02

Read-only SSH inventory and authenticated ASCII API metadata. Capacity is an
instantaneous observation, not a resource reservation or benchmark qualification.
No existing processes, services, filesystems or box lifecycle were changed.

| Host | Observed capacity | Finding |
| --- | --- | --- |
| fast-near-3tb-1 | 32 logical CPUs, 64 GB RAM, 2.3 TB free root | Best existing-server fallback. Low observed load; Node/tmux and other sessions still present. Ownership must be reconciled before using it. |
| fast-near-9tb-1 | 16 logical CPUs, 128 GB RAM | Root 100% used, only 68 MB free. Separate `/home` has 831 GB and `/data` about 1 TB free. Not ready for new services without addressing root capacity. |
| fast-near-9tb-2 | 20 logical CPUs, 64 GB RAM | `/home` 100% used; root has 8 GB free. Preserve existing jobs and data. |
| fast-near-64-1 | Unknown | SSH connection to 65.108.14.215:22 timed out; not evidence that the host is stopped. |
| ASCII bx_4r5uzdwv | API: 4 vCPU, 8 GB, health OK, no archive deadline | Existing project qualification host; coordinator/worker ownership remains in force. API `idle` does not include SSH jobs. |
| ASCII bx_xegf6upd | API: 4 vCPU, 8 GB, health OK | Older box marked idle, no SSH endpoint returned. Workload ownership unverified; left untouched. |
| Eight archived ASCII boxes | API: snapshots available/verified | wa-bench-2/3/4/5/6/8/9 plus bx_ujqnxrxr. None resumed or modified. |

The existing ASCII list was complete (`hasMore: false`), with ten boxes before
creating the new one. Private API receipts stay in ignored scratch files.

## New coordinator box

- ID: `bx_69aem736`.
- SSH endpoint reported by authenticated API: `137.74.205.128:19040`.
- Default size: 4 vCPU / 8 GB RAM.
- Automatic archival disabled (`ttlSeconds: null`, observed `archiveAfter: null`).
- Snapshots enabled; API reports a verified snapshot.
- Created with `noEnv: true`; `holdsCreatorLogins: false` observed.
- Independent of the existing benchmark box; no snapshot/fork of its work.
- API-command inspection confirmed x64, 4 CPUs, 8 GiB, Node v24.18.1, Git,
  tmux, Codex, Chrome and systemctl; 47 GB free on a 69 GB root volume.
- Private `/home/user/wine-assembly` and `/home/user/wine-assembly-prep`
  directories created; dashboard unit staged, not installed or enabled.
- SSH host public key obtained through the authenticated command API and
  recorded in ignored `scratch/ops-new-box-preparation.json`.

JavaScript preparation stages only private directories and a disabled loopback
dashboard service template. This is not a migrated repository, authenticated
agent, running coordinator, or publicly reachable dashboard. Next: snapshot and
transfer the selected project files, validate the private dashboard, configure
HTTPS/authentication, then arrange an explicit single-owner cutover.

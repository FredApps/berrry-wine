# VFS close/duplicate lifetime audit — 2026-09-21

Status: **open**. CRT termination now issues stream closes (`f903f56b`), but
the VFS still permits ordinary I/O through closed handles. Do not call complete
FILE/handle lifetime support finished.

## Source findings

- `VirtualFS.closeHandle` retains file records with `closed=true`, justified by
  a comment about an NSIS extraction thread using the installer after close.
- Ordinary `readFile`/`writeFile`/`setFilePointer` look up the retained record
  without enforcing its closed flag. `flushFileBuffers` does check it.
- `DuplicateHandle` creates real console/current-thread aliases but simply
  copies ordinary file-handle values. CRT `_dup` also returns the original
  nonnegative value. Those are not independently closable handles.
- File duplicates must share the underlying file position while retaining
  distinct handle lifetimes. Separate `CreateFile` calls instead have separate
  positions. See Microsoft's [DuplicateHandle contract](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)
  and [CRT duplicate-descriptor contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/dup-dup2?view=msvc-170).

## Exploratory NSIS A/B

No production source was patched. A temporary Node preload counted close and
subsequent read/write/seek calls. Its strict arm deleted the file handle on
close, rather than retaining the tombstone. The reusable version is now
`tools/probe-vfs-close.js`, explicitly loaded by `--require`; strict closure
requires the additional `--vfs-close-strict` argument. It is not shipping code.

| Route | Matching VFS name/size rows | Closes per arm | Read/write/seek after close |
|---|---:|---:|---|
| Winamp 2.91 `/S`, 8,000 batches × 5,000 blocks | 64 | 27 | 0 / 0 / 0 |
| Winamp 2.95 `/S`, same budget | 64 | 27 | 0 / 0 / 0 |
| Winamp 2.95 `/S`, `--threads`, 800,000-batch ceiling | 184 | 159 | 0 / 0 / 0 |

All three pairs have identical sorted VFS name/size listings and no reported
crash/unimplemented API. The longer 2.95 route reaches host exit code 0 after
9,717 batches with 81,075 API calls in both arms. The shorter routes stop at
their budget; expected EXE/MP3/output plugin sizes match the existing regression:
2.91 = 846848 / 141312 / 13824 bytes; 2.95 = 854016 / 274944 / 13824 bytes.
These are size comparisons, **not byte-content hashes**.

`--threads` configures Worker execution but does not prove the silent route
created a guest worker. The interactive 2.95 recipe was therefore also tried
with `--threads --trace-thread`. **Both arms fail to leave License Agreement**:
control 1000 appears at batch 575, Next is posted at 584, and the Installation
Options / Folder / Installing Files waits time out at 2394 / 4214 / 6034.
Both end at 25,986 batches with 12,296 API calls, one close and zero observed
post-close I/O. No extraction-worker creation was established. This is an
inconclusive negative control, not a passed interactive/Worker regression.

The probes used `--no-build` and the current shared worktree. Other agents had
uncommitted host/runtime changes, including VFS handle-number changes. Treat
these results as exploratory, not an isolated clean-commit A/B or a performance
benchmark. Initial default-batch-size runs were superseded by the explicit
5,000-block runs above and are not counted as completed extraction checks.

Reproduce the silent arms (omit the final strict flag for the baseline):

```sh
node --require=./tools/probe-vfs-close.js test/run.js \
  --exe=test/binaries/installers/winamp295.exe --args=/S \
  --max-batches=8000 --batch-size=5000 --max-seconds=60 \
  --dump-vfs --quiet-api --no-build --vfs-close-strict
```

Longer configured-Worker arm: add `--threads`, change the batch ceiling to
800000 and wall guard to 30 seconds. Interactive route omits `/S`, uses a
45-second guard, and adds:

```text
--threads --trace-thread
--input=1:wait-dlg-control:1000:6500,10:post-cmd:1,20:wait-title:Installation_Options:1800,30:post-cmd:1,40:wait-title:Installation_Folder:1800,50:post-cmd:1,60:wait-title:Installing_Files:1800,20000:post-cmd:1
```

Local exploratory logs: `/private/tmp/wa-close-{291,295}-{baseline,strict}-5000.log`,
`/private/tmp/wa-close-295-worker-{baseline,strict}.log`, and
`/private/tmp/wa-close-295-interactive-{baseline,strict}.log`. These temporary
artifacts are not assumed durable; the recipes and observations above are.

## Next implementation order

1. Separate file-handle identity from shared open-file state; wire real file
   duplication through `DuplicateHandle` and `_dup`. Test shared position,
   independent close, close-source, invalid handles and retained data.
2. Enforce close across read/write/seek/size/time/mapping paths, including the
   documented invalid-handle error, double close and pending provider reads.
   A valid duplicate or mapping must outlive closure of the source handle.
3. Re-run clean CLI and browser NSIS extraction, establishing an actual guest
   worker before claiming the original workaround unnecessary there. Repair
   the wizard baseline separately if it still cannot advance.

No evidence here justifies preserving the workaround as correct Win98 behavior,
nor claiming that deleting the handle alone completes the lifetime model.

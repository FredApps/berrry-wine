# Unpublished measured games: independent release gate audit

Four proposed reviews: `scratch/release-readiness-audit-20261003/proposed-reviews.json`. Detailed evidence, qualification hash verification and service observation: `audit.json`; reproducible JS generators adjacent. Root owns merging decisions into `ops/release-readiness.json`.

All four have accepted gameplay and narrow logical-submission measurements and are absent from the verified 42-app production desktop. None is independently declared release-ready. Current nine-file source hashes authenticate review time only; historical measured module hashes remain separate.

- Cave Story: original Japanese freeware and fan translation require separate package review. Preserved opening dialogue has garbled text; ordinary save-point movement/jump and short logical sample do not resolve text correctness. Exact original readme decoded without modification in audit directory.
- Icy Tower: bundled readme allows distribution in original form with credit/link and restricts commercial packaging. Current extracted installed fixture is not that original package. Review an original installer/import route or separately documented permission, then the actual shipping route.
- Moorhuhn 2: `test/binaries/candidates/moorhuhn-2/license.txt` explicitly restricts download hosting to G+J Computer Channel; branding/program changes prohibited. Existing local-only decision is substantive. Do not inherit Original Moorhuhn authorization.
- Winter: manifest and `test/binaries/SOURCES.md` explicitly retain local-only status. Separate terms/authorization needed; do not assume MH2 license or Original authorization applies.

For all: complete chosen dependency/license package closure and ordinary current-release configuration need review. MH2/Winter measurements explicitly use cooperative overrides; one-second rates with observer overhead are not default-worker or sustained release performance. Reload, round end/restart, progression and declared touch controls remain concrete bounded acceptance gaps, not asserted broken features. Old `ops/corpus-status.json` no-capture statements are stale and should not erase accepted current run evidence.

Read-only service observation: `/etc/systemd/system/wine-ops.service`, User=user, WorkingDirectory=/home/user/wine-assembly, ExecStart `/usr/bin/env node ops/server.js --port=8098`, active PID416843. `CanReload=no`, no ExecReload. `ops/README.md` says restart rebuilds cached reads. Historical board assigns service to ops-dashboard, with migrated coordinator performing a controlled restart on October3. Coordinate current backend/UI releases and designated coordinator restart; `systemctl reload` is not supported. No restart, deployment, runtime, or source mutation performed by this audit.

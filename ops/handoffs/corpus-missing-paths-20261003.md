# Missing corpus routes: independent read-only classification

Reproducible audit: `node scratch/corpus-missing-paths-20261003/audit.js`; report and derived lists adjacent. Used current `ops/emulator-server.js` catalog and `ops/readers.js`, with agent histories/process scanning disabled. No network, extraction, browser, compilation or production edits.

241 corpus entries split into **127 declared-file launchable, 96 missing-file entries, 18 without a registered route**. Thus the 114 unavailable entries are not 114 missing packages. The 96 entries have **2,267 unique exact absent paths**, including 86 executable paths and 16 missing manifests. Missing manifests make complete dependency closure unknown: the list is a lower bound, not a claim that restoring it alone restores every package. All listed missing paths were independently absent on disk; no existing-path validation rejection was mislabelled as missing.

Migration owner inputs:
- `scratch/corpus-missing-paths-20261003/missing-files.txt`: exact repo-relative normalized file list, deduplicated.
- `report.json`: file-to-candidate/app associations, kinds, route reasons, current run/task evidence.
- `priority-missing-files.txt`: 1,572 exact paths for 21 existing demo/shareware candidate routes; `priorities.json` retains licensing notes. These are local restoration priorities, not redistribution permission. Payload sizes remain unknown; use owner transfer size/free-space gates, no bulk unpack.
- `unregistered-routes.json`: 18 entries with alternate discovery hints and current presence. Hints are not conjunctive requirements. Includes Serious Sam demo, UT348/UT3, two NFS retail entries, seven GOG packages and six tool/installer entries. File restoration alone cannot create a registered route.
- `runtime-evidence-review.json`: seven declared-present entries with latest published failed route: Zuma, Crimsonland, AoE2, Diablo demo, JigssawMe, WEP16 Jigsawed and TicTacDrop. Failure may be guest/runtime, harness or unfinished route; summaries retained without inventing causality. Later private diagnostics/source repairs require separate reconciliation. These seven are not part of the 114 file/registration-unavailable entries.

Prioritize known existing routes within owner's finite disk budget: Snood/Arcanum/NFS2SE and other demo sets may have few missing paths, but path count is not byte size. Icewind alone has 920 missing references and must not be treated as a small restore. Retail Pirates is explicitly excluded from demo priority despite its license text containing "not a demo". Default registry/debug SDK routes are included in total inventory but do not outrank requested games.

No delivery or route availability is gameplay success. No runtime compatibility was inferred from file presence.

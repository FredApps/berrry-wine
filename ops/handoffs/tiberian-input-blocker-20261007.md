# Tiberian Sun ordinary input continuation

Lane `NEW-GAME-TIBERIAN-SUN-DEMO-20261006` is incomplete. The original private demo now displays the six-button main menu in ordinary presentation, but one reviewed New Campaign click does not advance to campaign selection or gameplay. Root accepted the generic rendering repair on main `3946d5f9c`; this handoff is not gameplay qualification.

Own worktree `/home/user/wt-darkstone-refill-20261007`, branch `findings/tiberian-paint-20261007`, started from `dc7bc18e7`. Final validated source `61ac72804e0c0ebd3b130fa5f098f7a94373aed4` requires preceding `5c5b128e1` and `cb94bb6e6`; root handles integration. Outcome documentation checkpoint `60b3c5cb8` precedes this handoff.

## Demonstrated repair and validation

Raw original DirectDraw frame already contained the full menu; the retained shared GDI child canvas contained the grey slab composited over it. Repair stamps actual accepted uploads, tracks fresh rectangular coverage only on the exclusive shared child canvas, and prunes coverage older than the primary presentation in ordinary and both post-processing paths. Tests cover stale background, independent children, actual upload versus lazy flush, and 32 fragmented-upload epochs. Focused JS tests and full build pass.

Fresh matching module is 1,720,920 bytes, SHA256 `7c6864f8e224a0d42c6743b3c088ce79349101182295b79b1e4fa8a4c3911cc0`; unchanged from baseline because the repair is JavaScript only. Build source receipt verifies 910 unchanged hashes. Exact ordinary Worker SHA256 `6f42f2b0c8d67acd6f3890ad893141ed571d7543d658e8ef3917e6a8d43a88d7`, without observer injection. Complete private route retains original 26-file demo plus DLL/TLB closure, 355 runtime pins and 29 normal binaries aliases.

Evidence root: `/home/user/wine-assembly/scratch/runs/20261007-tiberian-repair-preparation`. Read `result.json`, `investigation.json`, `analysis.json`, `artifact-index.json`, build/source/transfer receipts and `diagnostic/commands.jsonl`. All four normal screenshots were personally reviewed. `diagnostic/01-ordinary-menu.png` SHA256 `3631ab8e4814cc90661af6b20f5e6a18978f97062fb7388d9ee847c3d5db74ae` qualifies the menu repair only.

## Exact unresolved contract

Only one ordinary input was performed: page `(305,455)` on the reviewed New Campaign button. Page logging records WM_LBUTTONDOWN/UP to HWND `0x10004`, control ID 1559, but subsequent reviewed screenshots remain at the menu. This does not establish owning guest callback delivery or parent WM_COMMAND. Earlier command-delivery commentary was corrected. Enter queued near the deadline was rejected by the input reserve and never performed. No campaign or player-controlled gameplay is observed.

Measure the owning guest callbacks for 0x201/0x202, their client-coordinate lParam, native button tracking flag 0x200, capture and CallWindowProc chain, then parent WM_COMMAND/BN_CLICKED and original dialog procedure. Do not infer a cause from page queue records or separately sampled CPU getters. No input source fix is demonstrated.

Relevant source: `src/09c3-controls0-basic-wndprocs.wat`, button_wndproc/down/up/button_activate; `lib/renderer-input.js`, mouse queue and coordinate dispatch. Native button down sets tracking/pressed/capture; up requires tracking and an in-client point before activation. button_activate uses the canonical control ID and may queue modal parent commands. Original authenticated routines: subclass `0x57e790`, parent original `0x580ac0`, button original `0x580c00`, dialog `0x4dea40`; native defaults `0xffff0002`/`0xffff0004`. Static original button disassembly is `button-proc-disassembly.txt` in the repair evidence folder. It dispatches messages 6..0x21; this alone does not demonstrate a mouse defect.

Prior causal evidence folders: `20261007-tiberian-paint-preparation` (control creation and coherent positive bitmap loop), `20261007-tiberian-destination-preparation` (actual parent/child WM_PAINT callbacks), `20261007-tiberian-composition-preparation` (reviewed raw layers). All are under the same scratch/runs root. Startup observers had limited trace budgets; arm any future read-only observer at the reviewed input boundary. Preserve original args/results/receivers, no guest writes or API spoofing.

## Slots, fixtures and constraints

Ordinary runtime ran 23:44:36–23:47:34 UTC, browser/server quit, Chrome exit0 and streams0. Independent 23:48:48 verifies actual driver24300/Chrome24312 absent, no Chrome and baseline listeners; all355pins reverify. Only owned temporary remote prefix removed after durable copy, RELEASE23:49:14. Native build was separately released23:35:51. This worker owns no slot or running job.

Root requested fresh-thread rotation23:53:06; no new browser/native action is authorized here. Latest board records Winamp root cleanup and Antara queued grant after independent preflight. Consult actual current board before any new slot. Remote box `bx_pm3beak3` expires `2026-10-08T00:13:13.980Z`; Puppeteer remains `/home/user/tiberian-tools-20261007/node_modules/puppeteer`. Old box `bx_k8zct7tv` is STOPPED. Root owns lifecycle and grants.

Original SUN: `/home/user/wine-assembly/test/binaries/win98-games-a-d/CnC-TiberianSun-demo-SW/extracted/SUN.EXE`, SHA256 `f70dcf32a25fe63cde2dd16bcf60feea93a98c94fc371ee97446df247160414b`. Private APPS/HTML overlays are in `20261007-tiberian-sun-preparation`; preserve registration, ensure the visible HTML option exists, assert select returns `tiberian_sun_demo`, serve every normal binaries alias and recursive DLL/TLB dependency. No missing guest fixture/source path was demonstrated. Earlier diagnostic had missing UI icon `icons/apps/tiberian_sun_demo.png` and failed HTML-only raw-canvas collector; corrected native OffscreenCanvas collection is preserved in composition prep. Neither is a proven input cause.

Keep disk above2GiB; native2.8GB/browser2.9GB preflights. No local browser, guest data/state edits, forced controls, return spoofing, blind repeated menu runs, public deploy/config edits, Claude panes or subagents. Use JS scripts, append-only board echo with tail verification, explicit source paths. Root owns integration, STATUS/TODOS and messaging.

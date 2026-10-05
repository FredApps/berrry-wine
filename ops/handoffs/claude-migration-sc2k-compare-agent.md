# Handoff: sc2k-compare-agent (Claude Code session ac698f44-68ef-413b-b515-19e31a29a4f3)

- Owner session and local PID: Claude Code session ac698f44 (sc2k-compare-agent); no child processes left running.
- Objective and done criteria: Compare a short SimCity 2000 Win95 Demo session in our emulator against Win98 (v86), wall of screenshots in Preview; fix the starter-screen mismatch the user reported. Done.
- State: completed.
- Worktree, branch, relevant commits: main tree, branch main. Commit 40c1c484 "SimCity 2000 launcher: open maximized and draw the title artwork". Temporary worktree /private/tmp/wa-sc2k-startinfo already removed.
- Owned modified and untracked files: none. Everything I changed is committed in 40c1c484. The current dirty diffs in src/09a-handlers3-sync.wat and src/10-helpers.wat are NOT mine (other agents' later work). build/simcity2000-demo-wall.png is an untracked build output.
- What changed and what is verified: GetStartupInfo reports STARTF_USESHOWWINDOW+SW_SHOWNORMAL; InvalidateRect(bErase) marks covered children of a non-WS_CLIPCHILDREN parent for erase ($invalidate_erase_children); MDICLIENT native WM_PAINT sends its pending WM_ERASEBKGND; CallWindowProcA(native, WM_PAINT) no longer clears MDICLIENT's erase bit. SC2K launcher now maximized with title art, matches v86.
- Tests: passed on clean HEAD+patch: test-invalidate-erase-children (new), test-startup-info-boundaries, test-beginpaint-erase-callback, test-default-erase-dc, test-dialog-null-dlgproc-erase, test-hidden-window-erase, test-mdi-client-resize-child, test-mdi-default-procs, test-mdi-maximized-child-chrome, test-parent-child-paint-order.
- Remaining failures and blockers: none of mine. Noted on board earlier: main build gate failed on unincluded src/09a7h-video-mciavi.wat (another agent's). Other wall differences (city menu bar File/Help only, budget dialog placement/sunken fields, Video Warning missing a line) observed but not requested.
- Exact next command or investigation step: none required.
- Local child PIDs, ports, browser/control sessions: none (control VMs on :8160/:8161 stopped).
- Remote hosts, running jobs, resource claims: none.
- Safe stop/resume instructions: nothing to resume.
- Released claims: src/09a-handlers3-sync.wat $startup_info_init; src/09c3-controls.wat control_wndproc_dispatch WM_PAINT prologue.
- Retained claims pending coordinator acknowledgment: none.
- Last updated (UTC): 2026-10-02

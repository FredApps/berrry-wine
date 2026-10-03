# Handoff: marketing session 361d8f4f-158f-469d-b70b-904b9c3d7eeb

- Owner session and local PID: Claude Code marketing session 361d8f4f (interactive; no owned child processes).
- Objective and done criteria: plan and execute the wine-assembly relaunch marketing (StarCraft flagship, links to the desktop root). Engineering is described only, never implemented, in this session. There is no fixed done point; it is an ongoing plan.
- State: checkpointed, idle.
- Worktree, branch, relevant commits: main worktree `/Users/vg/Documents/projects/phone/wine-assembly`, branch `main`. This session made no commits.
- Owned modified and untracked files:
  - `MARKETING.md`: gitignored, private. The relaunch plan; the latest change is lesson 5 (the Moorhuhn video post-mortem).
  - `BERRRY-TODO.md`: gitignored, private. Spec for the berrry custom analytics events API, plus the OAuth return-URL bug.
  - `.gitignore`: added the `BERRRY-TODO.md` line after `MARKETING.md`. Uncommitted.
  - `README.md` line 40: the js-dos comparison row now reads "written directly in WAT rather than compiled from C". Uncommitted. The file also has hunks from other agents, so commit only that hunk.
  - This handoff file.
  - `lib/vlan-rtc.js` and `test/test-vlan-rtc.js` were edited earlier and then reverted to HEAD. This session doesn't own them now.
- What changed and what is verified:
  - Twitter, Search Console and berrry analytics findings are recorded in MARKETING.md.
  - The berrry prod DB was read only through the read-only `claude` user, against the aggregated tables, one month per query at most.
  - The Moorhuhn tweet (2104755611556876454) had 134 views and 0 likes. Diagnosis: 8s of static intro, a 110s length, and nothing showing it runs in a browser or on a phone.
- Tests, artifacts:
  - `/Users/vg/Downloads/moorhuhn-18s.mp4`: an 18s captioned recut with a URL end card, made from `wine-assembly-20260929013914-twitter.mp4`.
  - Scratchpad work is in the session scratchpad: `tw.py` and the frozen-recording smoke test.
  - No tests were run; this is a non-engineering session.
- Remaining failures and blockers:
  - Analytics can't measure launches or multiplayer until berrry adds the events API (BERRRY-TODO.md #1).
  - The OAuth return-URL bug is berrry-issues.md #1.
- Exact next step (pending user decisions):
  1. The user to choose the next "live now" post. The recommendation was StarCraft on the phone.
  2. Optionally record StarCraft and montage clips via frozen CLI (`run.js --control --frozen` + `tools/ctl.js record`) and build a rough cut.
  3. Draft the Show HN, Reddit, press and YouTuber copy pack.
  4. Repost Moorhuhn in German at about 18:00 CET with the recut.
- Local child PIDs, ports, browser/control sessions: none.
- Remote hosts, running jobs, resource claims: none.
- Safe stop/resume instructions: nothing is running. To resume, read MARKETING.md "Relaunch (Sept 2026)" and this file.
- Pending approvals: none.
- Released claims: all. The earlier `lib/vlan-rtc.js` CLAIM was already RELEASEd on the board.
- Retained claims pending coordinator acknowledgment: none.
- Last updated (UTC): 2026-10-03

# Telegram orchestrator bridge

Native Node.js; no npm dependencies. The bot runs separately from the agent so a terminal permission prompt does not stop Telegram polling.

- Token: ignored `scratch/telegram-token.txt`, mode 0600.
- Pairing, owner, update cursor and pending approval: `scratch/telegram/state.json`, mode 0600. Only the paired private Telegram account can chat or approve.
- Health: `scratch/telegram/health.json` and `watchdog.json`.
- Logs: `scratch/telegram/service.log`. Never print the token.

With the service stopped, run `node ops/telegram.js --pair`. Open `https://t.me/WineAssemblyBot?start=CODE` with the returned code within 30 minutes. The bot greets the account after pairing. Start the service with:

```sh
tmux new-session -d -s wine-telegram 'node ops/telegram-watchdog.js >> scratch/telegram/service.log 2>&1'
```

The dashboard must be running on port 8098 (`OPS_URL` can select another loopback port). The registered `orchestrator` in `ops/terminals.json` must refer to its current tmux pane and PID. Send `C-c` to the `wine-telegram` session to stop the service. A stale watchdog lock requires checking the PID before removing it; do not start two pollers.

Send plain text to steer the orchestrator. `/status` shows tasks, `/screen` reads the terminal, `/approvals` refreshes a pending command approval, and `/help` explains controls. Only final answers to `[Telegram]` user turns and explicitly marked `[Telegram update]` milestones are forwarded from the registered Codex session. Routine commentary and autonomous goal summaries stay on the dashboard. Approval notifications remain immediate. Direct replies should be brief and conversational; milestones should report completion, failure, or a blocker needing the user. Code fences render as monospace, with no repeated sender heading. Replies use a persistent queue in `state.json`; delivery receipts and retry errors are recorded there. The queue resumes after restart. Quiet-mode upgrades discard old unsolicited queued updates and recover recent Telegram turn identities without replaying history.

Chat requires a live Codex descendant of the registered pane PID and an empty recognized prompt. Browser control, an approval menu, or a draft prevents delivery. Text is sent literally with a `[Telegram]` prefix; Telegram commands are never forwarded as CLI commands. Messages wait in a durable FIFO queue when the terminal explicitly rejects input before sending any keys. `/queue` lists waiting messages; `/cancel` removes them. Up to 20 messages wait for at most one hour. Timeouts, crashes during delivery, and other ambiguous failures are never automatically retried; inspect `/screen` before resending.

Approval buttons bind the private account, Telegram message, prompt fingerprint; buttons stay valid while that exact prompt is live. Identity includes the registered target and complete normalized approval prompt; unrelated background output does not create a new request. Clicking rechecks the current dashboard prompt, then the terminal endpoint rechecks the pane/PID and prompt. Choices are accept once, decline, and—only when present in the live menu—always allow the exact displayed rule. No automatic acceptance or policy bypass. Other kinds of prompts require inspecting the terminal. Approval attempts are consumed before sending, preventing automatic replay after ambiguous delivery. Old buttons are retired when a different prompt appears or the prompt closes. Clicking a stale button automatically retrieves the current request without applying the stale choice.

Approvals use a bold heading and monospace command/rule entities, preserving literal text without HTML interpretation. Copied terminal menu choices and keyboard instructions are omitted. `/screen` is monospace too. Long output is split with valid per-message entity offsets. Eligible pending approvals are reformatted in place; past chat history is not rewritten. Standalone leading “Orchestrator” labels are removed from new replies.

The watchdog restarts its own child after exit or 60 seconds without a heartbeat. Telegram requests time out after 15 seconds and dashboard requests after 8 seconds. This supervises the bridge, not the orchestrator or dashboard. It cannot run while the host is asleep or powered off. Incoming action cursors advance before delivery to prevent replay. Outgoing text is retried until confirmed: an ambiguous network failure can duplicate a reply, but never automatically repeat an approval action.

API reference: [Telegram Bot API](https://core.telegram.org/bots/api).

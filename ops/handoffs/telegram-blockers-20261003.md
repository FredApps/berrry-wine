# Telegram /blockers

Previously missing from both handler and setMyCommands menu. Added read-only owner-authorized command, generated help/menu catalog, bounded field formatting and shared BlockerModel with dashboard dependency grouping, review ordering, cycle fallback and unsent approvals. Web script served through explicit static allowlist. No approval action or task mutation from /blockers.

52Telegram/model/dashboard tests PASS. Live browser and in-process bot formatter used the same current API snapshot:4primary blockers/1dependent at verification. Existing access checks, unknown state, menu/help parity covered. Scoped wine-ops and wine-telegram services restarted; actual Telegram getMyCommands confirms blockers registered. Browser closed. Evidence scratch/telegram-blockers-20261003; no synthetic Telegram chat sent.

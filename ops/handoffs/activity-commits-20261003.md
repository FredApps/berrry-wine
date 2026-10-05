# Dashboard activity commits

Live Activity merges up to150 unique Git commits reachable from local refs and150 board messages. SHA deduplication, strict known timestamps, safe GitHub-origin links,30second Git cache and bounded async execution; no fetch. Unknown message dates retain board order after dated entries. UI All/Commits/Messages filter combines with search, preserves auto-refresh selection and paginates all matching rows. Git failures appear locally in Activity while messages remain usable.

Validation:28 backend/existing ops tests passed; public authenticated Puppeteer checked150commit ShowAll, exacthash search, sourcefilters, persistence across refresh and390px mobile with no overflow or JS errors. Screenshots/receipt: scratch/activity-commits-20261003/. Scoped wine-ops.service restart applied backend; no game deployment. All owned browsers closed.

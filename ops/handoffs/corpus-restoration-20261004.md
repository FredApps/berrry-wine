
## 2026-10-05 selective restoration on the box

Restored twelve of the 156 audited missing paths without repeating the bulk transfer. Exact receipts and the remaining 144 paths are in scratch/corpus-path-repair-20261005/.

- devhell1.xm: original modules_0.zip from the documented OpenGameArt source; extracted 8,765-byte XM1.04, eight channels, SHA256 2af98341ea8378a203679f4dff4e26894f7a611a50a5fc27de682a5a117694f1.
- Snood installer: original DiscMaster package, pinned SHA256 af87ef644d2a8d5a99f160ac522a7d318b0dc378285fd337c53dbf41c70db4ea. Actual emulator bootstrap and installer recreated the installed executable and browser manifest. Installed executable matched the existing pinned hash.
- Baldur noninteractive: downloaded original BALDUR.EXE, 34,296,832 bytes, pinned SHA1 e7caae4255e8ed570cef3a29642432c8d28ecdb9. Extracted eight files (52,381,414 bytes) and replaced only its confirmed dangling migration symlink. This is fixture availability, not gameplay qualification.

Snood session84075 passed both installer and frozen ordinary mouse gameplay checks on isolated main d00493a0 JavaScript with current private module3a65a4f1. Initial attempts failed before guest startup because the sparse checkout omitted fonts; materializing tracked fonts fixed the harness. Installer image had323 colors; two gameplay frames had482 colors and4,623 changed pixels after firing. Root reviewed gameplay-b.png showing the board and shot. Two audio voices submitted21,290 bytes; audible quality and FPS remain unmeasured. Processes exited0 and runtime was released. Exact pins, screenshots and result: scratch/corpus-path-repair-20261005/snood-{pins,result}.json and snood-shots/. New screenshot delivered to Telegram as message460. All fixtures remain ignored/local.

Remaining blockers: Baldur interactive89 paths; original BG Demo.iso HEAD returned403 and archive metadata returned no file listing. Chapters I–II55 paths; verified archive metadata reports612,538,616 compressed bytes, exceeding current free storage even before extraction. Exact source response and archive-size receipts are adjacent to remaining-files.txt. No missing payload was relabeled playable, and no public deployment occurred.

# Dungeon Siege interrupted-worker recovery

At23:23UTC the coordinator verified API worker434465 had exited1 at16:56:46.291UTC after a CLI usage-limit error. No worker remains active. The prior active dashboard label was stale. No retry of the exhausted worker was attempted.

Original CAB extraction37files206866962B and canonical build module e4d59e88c62dd17cafaa836120e35e891cd56b497bd80190c980696adc98396c were reported passing. A browser started16:53:46; retained early captures show loading, and the worker recorded startup unreachable at EIP4362b4 before a guest window. No input/gameplay/FPS/audio qualification. The stdole2 data-file comparison's final outcome was not recovered.

Local partial evidence is sealed at scratch/runs/20261008T2323Z-dungeon-siege-interrupted-recovery/result.json:20 artifact hashes, source archive/pins/dirty patch, extraction and build receipts, original inputs and early captures. The browser-finish timestamp is unknown; recorded finishedAt is the worker's exit/capture cutoff. Source WIP is archived on GitHub as archive/wt-dungeon-siege-interrupted-20261008 at31ccb5972; five explicit paths, extractor syntax check passed. WIP is not accepted into main as a working launch route.

Box bx_hgju4y2b is stopped with snapshot verified19:33:39.845UTC. On23:23:55 root tried a new retrieval-only resume; Boat denied sandbox.resume with403 api_key_action_forbidden, This API key cannot perform sandbox.resume. No remote execution occurred in recovery and no permission/credential changes were attempted. Prior ordinary Boat exec permission does not grant resume permission.

Missing remotely: /home/user/dungeon-api-20261008 complete evidence/browser logs, later captures, final browser/PID/socket cleanup receipt, built module, and original extracted37-file payload/browser manifest. The initial immutable browser guard was17:33:46.482UTC; its actual closure was not retrieved. Automatic box stop is confirmed, but must not be relabeled as verified browser cleanup. The original local installer remains present and unchanged.

Next: an owner with resume permission resumes bx_hgju4y2b for evidence retrieval, or supplies its preserved /home/user/dungeon-api-20261008 evidence and payload. Keep recovery separate from a new runtime phase. Verify hashes and inspect terminal startup evidence before a targeted compatibility repair. Until then registration remains archived WIP. Age of Wonders II retains its separate queued source diagnostic; both new-game gameplay objectives remain open.

## Independent static follow-up,23:29UTC

Root extracted ONLY DungeonSiegeDemo.exe from the unchanged installer using
7z23.01;3608640B SHA8df1ba314073f8e9e7b48c7ed0fd3a976b1dafb722bffcb41f613a4c60a421ab
matches the prior remote cabextract receipt. No guest execution. Sealed static
evidence: scratch/runs/20261008T2329Z-dungeon-siege-static-fault/result.json.

Observed trap EIP4362b4 is a block start. Original block calls KERNEL32
EnumResourceTypesA via IAT6f5218 at4362c3. Its callback4363e8 calls
EnumResourceNamesA(IAT6f5214), whose callback436402 calls
EnumResourceLanguagesA(IAT6f5210). Final callback436420 writes the first
language WORD to lParam and returns FALSE. TypesA and LanguagesA are absent
from current main API table/handlers; NamesA and LanguagesW exist. This is a
concrete missing-API chain, not yet proof of the exact trapping instruction.
Next implement generic nested resource enumeration with real callbacks,
early-stop semantics and preserved CPU/stack state, validate a real-dispatch
regression remotely, then test the original startup route. No hardcoded game
result or speculative zero-return stub. Final old-run logs still need recovery.

# Comanche 3: AH5A review candidate

Private candidate a1ca7441 implements DOS temporary-file creation on the existing mounted C root, with unique names, caller-buffer writeback, real in-memory handles and readonly/access behavior. Other directory paths fail explicitly. Original media remains unchanged; no host payload files are written.

Thirteen real-handler groups and unchanged native DOS-files/ioctl tests passed in final-ready/tests-attempt2. The earlier 14d candidate fails the added truncation identity test. A first correction failed old-handle EOF; the final candidate preserves shared record identity and updates existing handle buffers on truncation without resetting their file positions. This commit is for review, not integration approval.

Shared-handle follow-up: the earlier candidate failed a real second-handle read after a 5000-byte growth (returned zero instead of seven). Temporary-record writes now refresh every handle sharing that record while retaining each position and access mode. Fifteen pure-JS contracts pass, including growth beyond the original buffer, seek-to-end, readonly refusal, and truncation followed by replacement bytes visible at an existing offset. The original 13-contract/native files/ioctl receipts predate this small follow-up; no new guest run is claimed.

The original installer run finished 2026-10-07T13:49:13.028Z with clean process/stream closure and all five original file hashes unchanged. Child INSTALL.BIN exited 1; parent wrapper exited 0. The visible message remains insufficient extended memory, followed by missing setup.exe. No installed payload or gameplay was produced.

Correction to initial log skim: the log includes NUL print bytes, so text search must use binary-as-text mode. Actual trace proves AH5A at CS0540:4612 returned handle7, and seek4202 at CS0540:762a returned0 using that handle. The former unsupported-API/invalid-handle failure is resolved; this is not an earlier return and not proof of a capacity problem. Cleanup deletes the temporary file, explaining generated[].

Original inner MZ image offset05ed plus original CS0385 yields the code image; actual CS0540 matches the retained trace. Static continuation 7538 calls75ee (free-space/seek), then7543 computes available memory. Startup4798 calls745e and47a2 calls843c. At8474 a subtraction updates dword[3538]; carry at8479 branches to840d, which selects error string36e5. These are authenticated original instructions, not captured branch execution or runtime operand values. A next diagnostic should capture the owning real-mode data values around this subtraction, rather than change XMS capacity or repeat inputs.

Contract reference: https://www.pcjs.org/documents/books/mspl13/msdos/encyclopedia/section5/ (Function5AH).

Fresh origin/main-based review and native validation now confirm a separate
generic interrupt word-return defect behind the later memory error. See
[the tested repair and remaining installer blocker](comanche3-memory-repair-20261007.md).

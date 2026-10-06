# ScummVM: underlying directx mode failure

Actual mode-return proof is published separately in7c34f621: SDL_SetVideoMode(640,400,16,fullscreen) returns NULL on owner thread1, driver `directx`. The640x480 host resize is a separate later presentation observation. The following analysis uses the exact pinned SDL.dll6a86f58b, not a guessed current SDL implementation.

The directx bootstrap descriptor at preferred10033d40 points to device factory10015d00. That factory writes10016a30 into device+0x0c (at10015d89). Generic SDL_SetVideoMode invokes device+0x0c at10026629 and examines returned EAX at1002662c. This is the first driver-specific return boundary. A NULL generic result alone does not establish which inner DirectDraw method failed: generic code has other failure checks too.

Inside the directx mode function, useful exact return PCs are:

-10016f44: IDirectDraw2 SetCooperativeLevel, vtable+0x50; negative return reports the exact method name then returns NULL.
-100170a1 /100170c1: SetDisplayMode, vtable+0x54, first requested refresh then refresh0 retry. If both fail it recursively retries windowed mode; a nonzero HRESULT here alone is not final failure.
-10017197 /100171db: primary CreateSurface, vtable+0x18, with optional flag-reduction retry. Final failure passes HRESULT and `DirectDraw2::CreateSurface(PRIMARY)` to error formatter10016010.
-10017212: primary QueryInterface;10017268: surface GetSurfaceDesc, vtable+0x58. Failure reports through the same formatter. A subsequent pixel-format RGB check at10017287 also returns NULL through SDL_SetError without a failing COM HRESULT.

Therefore capture one inner return guessed in advance would risk missing the actual failure. The smaller next proof is to extend the existing paired mode-entry/return snapshot with **read-only SDL error state**, without another trace range or calling SDL_GetError.

Exact error storage is source-backed: SDL_GetErrBuf atRVA25820 starts with default SDLbase+3c108. If thread table pointer[base+3c418] is nonzero, it scans count[base+3c414] table pointers; each record begins with Win32 thread ID and the matching record's error struct is+0x10. SDL_ThreadID RVA25160 forwards IAT2d08c to GetCurrentThreadId; pinned WAT09a-handlers3-sync:8 returns current_thread_id. Thus actual owner1 can be matched without invoking guest APIs.

Read a capped table (e.g.16 rows), reject count overflow, duplicate owner matches, invalid pointers or changed count/table/row IDs on a second read. Preserve the default choice when no row matches, exactly as the binary does. This read is non-atomic with other Workers; report/reject detected instability rather than taking guest locks.

SDL_SetError RVA190e0 sets error flag at+0, copies128-byte format to+4, resets argument count at+0x84 and stores up to5 arguments in128-byte slots from+0x88. String arguments are copied, not merely borrowed pointers. Capture those raw bytes at mode entry and return (776 bytes maximum per selected struct), preserving stale/unchanged distinction and truncation. DirectDraw formatter10016010 also writes text into global base+370c0 and calls SDL_SetError("%s",buffer); snapshot that bounded buffer at both boundaries as secondary evidence, never sole owner attribution. SDL_GetError itself allocates/formats and the selector locks a mutex, so **do not call it as a read-only getter**.

This can identify the specific final error without broad trace spam. If no changed owner-associated error exists, retain unknown and use the proven driver return2662c plus selected explicit COM return PCs in a separately reviewed diagnostic. No production patch is justified yet. The DirectDraw implementation may accept a display change but fail later surface creation/description; changing the renderer fullscreen heuristic would not address the proven NULL return.

Narrow disassembly retained in scratch/scummvm-av-20261003/mode-return/{sdl-setvideomode.asm,sdl-directx-init.asm,sdl-directx-setmode.asm}. No further browser, build or guest execution occurred during this analysis.

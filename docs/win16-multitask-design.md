# A second Win16 task in the same emulator

Status: design, 2026-09-29. Driver: Civilization II (Win16) runs its
Civilopedia as a separate program, `PEDIA\GET_INFO.EXE` (an Authorware 3
runtime), and talks to it through the window system:

```
Civ2:  WinExec("get_info.exe ...")          seg50:0x142e..0x150b
       loop FindWindow("Get_Info") until found
       ShowWindow / SendMessage to it with the topic
```

Today `$win16_WinExec` hands the command to `$host_shell_execute`. Headless
that launches nothing and returns 33; the browser boots a *separate emulator*
with its own window table. Either way FindWindow never succeeds and Civ2 loops.
GET_INFO itself runs standalone since d7db2f9e/4d5cc38c.

## What Win 3.x actually does, and what we copy

On Win 3.1 every task shares one address space, one LDT, one USER window list
and one GDI heap. Tasks are scheduled non-preemptively: a task gives up the CPU
only inside GetMessage/PeekMessage/WaitMessage/Yield. SendMessage to another
task's window switches to the receiving task, runs its wndproc, and switches
back. We copy exactly that model:

- **One selector space.** Selectors, the thunk table, the handle map and the
  window table are shared. A handle one task receives is valid in the other.
- **Per-task CPU and task state.** Registers, segment registers, `$code16`, the
  DGROUP/local heap, PSP/environment/DTA, message queue, quit flag and main
  window.
- **Cooperative switching** at the message calls only.

## Mechanism: a task is a cooperative guest-thread instance

Guest threads are already separate `WebAssembly.Instance`s over the shared
memory (`ThreadManager.spawnPending`, `init_thread` in 13-exports). Every
mutable global — `$sreg_*`, `$seg_base_*`, `$code16`, `$win16_auto_data`,
`$win16_lheap_*`, `$win16_psp_sel`, `$main_hwnd`, `$quit_flag`, the post queue
cursor — is therefore already per-instance. There is no save/restore of
globals to write, and a Win16 task instance carries its own selector
registers automatically. Windows record their creating thread
(`$wnd_thread_addr`), and paint delivery already goes to the owner.

So a second task = a new cooperative thread instance whose entry is a Win16
task start instead of a Win32 thread proc. It runs under the cooperative
scheduler (default) and, later, the worker backend.

## What is wrong today, in order

### 1. Allocator cursors are per-instance globals over shared tables

These index shared memory, but each instance keeps its own cursor, so two
instances would issue the same selector/handle twice:

| global | table |
|---|---|
| `$win16_next_seg` | `$WIN16_SEG_TABLE`, arena slots |
| `$win16_sub_next`, `$win16_pool_base/used` | sub-selectors 1024..8191 |
| `$win16_thunk_count` | `$WIN16_THUNK_TABLE` |
| `$win16_handle_next`, `$win16_res_handle_next` | 16<->32 handle map (arena slot 959) |
| `$win16_mm_timer_next` | MM timer table |

Fix: move each into a word in shared memory (a small `WIN16_SHARED` region, or
the unused tail of slot 959) behind `get`/`set` helpers. With one task this is
behaviour-neutral, which is testable on its own: every existing Win16 test
must still pass unchanged. This is Phase 1 and lands first.

### 2. `$load_ne` replaces the first task

It restages at `$PE_STAGING`, zeroes the segment and thunk tables, places
segment *i* at arena slot *i*, and resets the handle map, INT vectors and
dynamic modules. A second task must never go through it.

The NE **DLL** path (`$load_ne_dll_sized`) already does what a second image
needs: it stages into its own record (`$win16_dll_staging(module_id)`),
appends segments at `$win16_next_seg` via `seg_index_base`, relocates against
the shared thunk table, and resource lookup already follows the image by
module id or CS (`$win16_res_ne_off`/`$win16_res_base_addr`). So the second
EXE loads as a *module* through that path, taking a dynamic module id. It
differs from a DLL only in its start: an EXE has its own stack in DGROUP, an
entry CS:IP, a heap size, and no LibMain.

GET_INFO.EXE is 11 MB, but that is an appended Authorware payload that the
program reads back through the VFS. Its segments, header and resources are
well under 1 MB, within the 6 MB shared app-DLL staging image.

### 3. Task start is tied to task 1

`$win16_start_task` (08c:940) calls `$win16_handle_reset`, which is wrong for
task 2. Split it:

- `$win16_task_boot` (per task, runs on the new instance): DGROUP instance
  header, local heap, PSP + environment + command line, DS/SS/ES/CS, SP,
  entry EIP, `$code16`, `$is_win16`, and `$win16_auto_data` from the module's
  record.
- `$win16_start_task` = handle reset + `$win16_task_boot` for task 1 only.

New export `win16_task_init(module_id, cmdline_ptr, show)`, called by the host
on the fresh instance right after `init_thread`.

### 4. WinExec

`$win16_WinExec`: resolve the path through the VFS. If it is an NE
executable, do the following. Anything else keeps today's host launch.

1. Yield to the host to stage the file into a free dynamic module slot. This
   reuses the LoadLibrary yield/stage path (`handleLoadLibraryYield` in
   lib/process-boot.js) and needs no new host plumbing beyond a kind flag.
2. `load_ne_dll_sized` places it. On failure, return 2/11 (file not
   found / bad format) like Win 3.1.
3. Ask the thread manager to spawn a cooperative instance with the Win16 task
   entry (`win16_task_init`). The new task's hTask/hInstance is its DGROUP
   selector.
4. Return hInstance (> 32) to the caller. Like Win 3.1, the caller keeps
   running until it yields; the child's first slice comes at the caller's next
   GetMessage/PeekMessage/Yield.

### 5. Switching points

The cooperative scheduler already rotates instances per batch. Win16 needs
one more rule, because a Win16 program is allowed to busy-poll: Civ2 loops
FindWindow → PeekMessage. So `$win16_PeekMessage` returning "no message",
KERNEL.29 Yield (missing today) and WaitMessage must end the slice
(`yield_flag`) whenever another Win16 task is runnable. GetMessage's idle path
already yields.

### 6. Cross-task SendMessage

`$win16_SendMessage` calls the wndproc directly and never checks the owner.
For a window owned by another instance it must do what `$handle_SendMessageA`
does:

1. Set `$send_target_tid` and the send registers.
2. Rewind to the thunk and yield reason 10.
3. The host runs the send on the target. The target side needs a Win16
   variant of `thread_send_begin`: it pushes a *Pascal far* frame and returns
   through the WIN16 thunk selector (`$win16_enter_wndproc`'s shape), instead
   of the 32-bit stdcall frame and `$sync_msg_ret_thunk`.
4. It completes with `complete_thread_send` and DX:AX.

Far-pointer lParams are valid across tasks because the selector space is
shared. That is also true on Win 3.1, and Civ2/Authorware rely on it.

PostMessage to another task's window goes to that tid's post queue, as for
Win32 threads.

### 7. Things to watch

- `$win16_call32_begin` runs 32-bit handlers on the fixed `$GUEST_STACK`
  scratch. The cooperative scheduler never interleaves two instances inside
  one handler, and the waited path cancels rather than parks. A cross-task send
  happens outside call32. It is safe under coop; under the worker backend each
  instance needs its own scratch, so this is a worker-mode prerequisite, not
  phase work.
- Task exit: when task 2 posts WM_QUIT and returns from WinMain, its thread
  exits. Its windows are destroyed by the existing thread-exit path, and its
  module record is unloaded. Task 1's exit ends the process as today.
- `GetCurrentTask`, `GetWindowTask`, `IsTask`, `TaskFindHandle`, `GetModuleUsage`
  and `GetNumTasks` must answer per task: DGROUP selector for hTask, owner
  thread → task.
- Timers: `SetTimer` delivery is already per owning thread.

## Phases

| phase | change | proof |
|---|---|---|
| 1 | shared allocator cursors | all Win16 tests unchanged; unit test: two instances allocate distinct selectors/handles |
| 2 | load an EXE as a module without disturbing task 1 | unit: after loading GET_INFO as module N, task 1's segments/resources/thunks are byte-identical |
| 3 | `win16_task_init` + scheduler spawn; WinExec in-process | headless: Civ2's WinExec creates a live "Get_Info" window, FindWindow finds it |
| 4 | Yield/PeekMessage slice ends; cross-task SendMessage | Civ2 Civilopedia shows a topic in GET_INFO |
| 5 | task queries, exit/cleanup | second WinExec after the first closes |

The browser keeps launching Win32 children as separate apps. Only NE-from-NE
WinExec takes the in-process path.

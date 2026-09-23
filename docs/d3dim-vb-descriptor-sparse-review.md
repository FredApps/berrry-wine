# Vertex-buffer descriptor readback across sparse pages

2026-09-22. Guest-pointer and shared-implementation follow-up.

GetVertexBufferDesc's shared core translated the caller's pointer once and
used raw memory copy/fill plus a raw size-field store. A descriptor can
cross guest pages whose WASM backing is not adjacent; the size DWORD itself
can cross that boundary. Creation's page-safe input handling did not make
this output path safe.

The new regression failed with the three fields after dwSize still holding
the sentinel pattern. The fix delegates copying and zero-filling to the
existing guest_memmove/guest_memset helpers and writes dwSize with gs32.
It does not allocate temporary span storage or add another copy implementation.

The regression extends the existing VB/VB7 public-dispatch alias test rather
than creating another harness. Its output starts two bytes before a guest
page boundary. Backing pages are deliberately interleaved; an unrelated
page is filled with canaries. Each version exercises 16- and 32-byte output,
both with a stored descriptor and with the existing no-input-descriptor
creation path, and checks guards before/after the output and on the unrelated
page. Existing lock, release/refcount and stdcall checks remain in place.

All eight sparse readback cases pass. The creation allocation-failure and
overflow suites also pass (24 failures/retries, eight oversized rejections,
two exact allocations above 4 MiB). Fragment, ESP, logical-operand, quiet,
duplicate and whitespace checks pass. Quiet remains 243 manual + 22 metadata;
the duplicate baseline remains 119 groups / 476 members.

This is a guest-memory correctness test, not native certification of the
existing descriptor-size clamp, null-input policy, FVF validation or interface
availability. Those semantics remain separate audit items.

Source audit lead: material Set/Get and device-7 material Set/Get in the
same core still use one translated pointer for guest structures. They need
their own boundary/canary regressions; this change does not fix them.

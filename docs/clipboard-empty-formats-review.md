# Empty clipboard payloads versus absent formats — 2026-09-22

The string/handle audit found that format availability was inferred from
`clipboard_len > 0` and `clipboard_rtf_len > 0`. Successfully storing a
NUL-only payload therefore returned success but disappeared from Count,
IsAvailable, Enum, GetClipboardData and the OLE wrapper.

Two explicit presence flags now distinguish that payload from an absent
format. Lengths remain byte counts excluding NUL; allocated capacity can
survive EmptyClipboard without advertising data. All production length
writers were audited: public text storage, explicit RTF storage, RTF synthesis,
native Edit copy, the RichEdit snapshot bridge, object-only projection removal
and clearing. Format queries/enumeration and OLE wrapping read presence;
copy loops and size calculations still read length. Retiring a buffer before
growth clears its presence so an allocation failure cannot advertise it.
No memory region or host mirror changed.

The interpretation follows the documented NUL-terminated
[CF_TEXT/CF_OEMTEXT representation](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats)
and [format-availability contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-isclipboardformatavailable).
This is not a fresh native Win98 observation. Empty registered RTF payloads
are stored as bytes; the clipboard does not certify that they parse as RTF.

The public-handle regression covers empty text/OEM retrieval and locking,
enumeration, empty registered RTF, synthesis from present empty text, clearing
despite retained capacity, and OLE QueryGetData/GetData returning the one-byte
terminator. The enum fixture now seeds presence explicitly. Native EDIT
coverage checks that nonempty WM_COPY still publishes a format.

A compiler-only negative control restoring the pre-change runtime sources
fails at `empty text is a present format`; no shared files or build artifacts
are changed by that control. An early positive test exposed a fixture omission:
the synthetic open transaction had no open HWND, so real EmptyClipboard
correctly removed ownership and a subsequent SetClipboardData failed. The
fixture now supplies that HWND rather than bypassing the handler.

Verification passes: expanded clipboard public-handle/OLE test, format
enumeration, native Unicode EDIT (including clipboard copy), RTF 36/36, and
fragment/ESP/logical-AND/quiet-inventory/tier/whitespace gates. The quiet
inventory remains 248 manual + 22 metadata. Test coverage of the RichEdit
snapshot producer is indirect; no WordPad UI run was performed.

Limitations: exact CountClipboardFormats accounting for synthesized/OLE
formats, insertion-order enumeration, encodings, delayed rendering, ownership
transfer and stale-handle lifetime remain open. Native control empty-paste
semantics have **not** been established; the existing no-op policy is preserved
and tested as current behavior, not asserted as Windows conformance. No
browser, full-release, performance or native OOM result is claimed.

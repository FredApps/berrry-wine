; caesar3-loading-12-0x004171cc
; runtime 0x004171cc  module c3.exe  orig 0x004171cc
; entries 1056737  guest ops 7  retired 7397159  2.16% of window

004171cc  8b 4d f8                     mov ecx, [ebp-0x8]
004171cf  c1 e1 07                     shl ecx, 0x7
004171d2  c7 81 b8 64 86 00 00 00 00 00 mov dword [ecx+0x8664b8], 0x0
004171dc  8b 55 f8                     mov edx, [ebp-0x8]
004171df  c1 e2 07                     shl edx, 0x7
004171e2  83 ba 60 64 86 00 00         cmp dword [edx+0x866460], 0x0
004171e9  7f 40                        jg short 0x41722b

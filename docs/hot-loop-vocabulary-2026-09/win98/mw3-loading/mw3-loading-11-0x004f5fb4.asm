; mw3-loading-11-0x004f5fb4
; runtime 0x004f5fb4  module mech3demo.exe  orig 0x004f5fb4
; entries 1064825  guest ops 6  retired 6388950  0.52% of window

004f5fb4  66 c7 01 00 00               mov word [ecx], 0x0
004f5fb9  8b 16                        mov edx, [esi]
004f5fbb  40                           inc eax
004f5fbc  83 c1 02                     add dword ecx, 0x2
004f5fbf  3b c2                        cmp eax, edx
004f5fc1  7c e8                        jl short 0x4f5fab

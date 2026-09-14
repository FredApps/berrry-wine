; mw3-05-0x0042d9b1
; runtime 0x0042d9b1  module mech3demo.exe  orig 0x0042d9b1
; entries 35840  guest ops 7  retired 250880  2.35% of window

0042d9b1  66 8b b1 fc 00 00 00         mov si, [ecx+0xfc]
0042d9b8  40                           inc eax
0042d9b9  66 89 32                     mov [edx], si
0042d9bc  8b 71 3c                     mov esi, [ecx+0x3c]
0042d9bf  83 c2 02                     add dword edx, 0x2
0042d9c2  3b 06                        cmp eax, [esi]
0042d9c4  7c eb                        jl short 0x42d9b1

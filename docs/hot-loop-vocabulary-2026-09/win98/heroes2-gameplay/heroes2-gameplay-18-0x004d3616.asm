; heroes2-gameplay-18-0x004d3616
; runtime 0x004d3616  module H2DEMOW.EXE  orig 0x004d3616
; entries 348000  guest ops 5  retired 1740000  1.20% of window

004d3616  8b d1                        mov edx, ecx
004d3618  83 e2 03                     and dword edx, 0x3
004d361b  c1 e9 02                     shr ecx, 0x2
004d361e  f3 a5                        rep movsd
004d3620  ff 24 95 28 36 4d 00         jmp [0x4d3628+edx*4]

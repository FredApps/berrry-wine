; quake2-loading-02-0x00426313
; runtime 0x00426313  module quake2.exe  orig 0x00426313
; entries 1840675  guest ops 8  retired 14725400  5.36% of window

00426313  c1 f8 08                     sar eax, 0x8
00426316  88 44 3e 14                  mov [esi+edi+0x14], al
0042631a  8b 54 24 14                  mov edx, [esp+0x14]
0042631e  46                           inc esi
0042631f  03 d1                        add edx, ecx
00426321  3b f5                        cmp esi, ebp
00426323  89 54 24 14                  mov [esp+0x14], edx
00426327  7c 98                        jl short 0x4262c1

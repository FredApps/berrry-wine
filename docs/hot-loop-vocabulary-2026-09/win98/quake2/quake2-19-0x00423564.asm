; quake2-19-0x00423564
; runtime 0x00423564  module quake2.exe  orig 0x00423564
; entries 366007  guest ops 8  retired 2928056  0.80% of window

00423564  0f be 02                     movsx eax, byte [edx]
00423567  0f be 0e                     movsx ecx, byte [esi]
0042356a  42                           inc edx
0042356b  46                           inc esi
0042356c  8b df                        mov ebx, edi
0042356e  4f                           dec edi
0042356f  85 db                        test ebx, ebx
00423571  75 cb                        jnz short 0x42353e

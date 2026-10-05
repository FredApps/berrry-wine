; mw3-loading-10-0x0052805a
; runtime 0x0052805a  module mech3demo.exe  orig 0x0052805a
; entries 969311  guest ops 8  retired 7754488  0.63% of window

0052805a  8b fe                        mov edi, esi
0052805c  89 55 e8                     mov [ebp-0x18], edx
0052805f  2b fb                        sub edi, ebx
00528061  89 7d e4                     mov [ebp-0x1c], edi
00528064  8b 4d 0c                     mov ecx, [ebp+0xc]
00528067  8a 09                        mov cl, [ecx]
00528069  80 f9 03                     cmp byte cl, 0x3
0052806c  0f 86 85 00 00 00            jbe 0x5280f7

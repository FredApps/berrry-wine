; mw3-loading-07-0x00528111
; runtime 0x00528111  module mech3demo.exe  orig 0x00528111
; entries 969311  guest ops 14  retired 13570354  1.09% of window

00528111  8b 75 10                     mov esi, [ebp+0x10]
00528114  8b 4d f0                     mov ecx, [ebp-0x10]
00528117  8b 45 f8                     mov eax, [ebp-0x8]
0052811a  8d 1c 43                     lea ebx, [ebx+eax*2]
0052811d  8b 45 08                     mov eax, [ebp+0x8]
00528120  03 c8                        add ecx, eax
00528122  89 5d f4                     mov [ebp-0xc], ebx
00528125  8d 34 46                     lea esi, [esi+eax*2]
00528128  8b 45 fc                     mov eax, [ebp-0x4]
0052812b  48                           dec eax
0052812c  89 75 10                     mov [ebp+0x10], esi
0052812f  89 4d f0                     mov [ebp-0x10], ecx
00528132  89 45 fc                     mov [ebp-0x4], eax
00528135  0f 85 0f ff ff ff            jnz 0x52804a

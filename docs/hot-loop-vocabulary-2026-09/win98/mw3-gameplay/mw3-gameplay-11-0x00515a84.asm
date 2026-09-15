; mw3-gameplay-11-0x00515a84
; runtime 0x00515a84  module mech3demo.exe  orig 0x00515a84
; entries 96736  guest ops 21  retired 2031456  1.08% of window

00515a84  8b 30                        mov esi, [eax]
00515a86  8b 50 08                     mov edx, [eax+0x8]
00515a89  a1 dc 40 70 00               mov eax, [0x7040dc]
00515a8e  81 e6 ff 00 00 00            and dword esi, 0xff
00515a94  b9 e4 43 70 00               mov ecx, 0x7043e4
00515a99  89 45 f8                     mov [ebp-0x8], eax
00515a9c  8b 02                        mov eax, [edx]
00515a9e  8b 7d f8                     mov edi, [ebp-0x8]
00515aa1  83 c2 04                     add dword edx, 0x4
00515aa4  8d 04 40                     lea eax, [eax+eax*2]
00515aa7  8d 04 87                     lea eax, [edi+eax*4]
00515aaa  8b f9                        mov edi, ecx
00515aac  83 c1 0c                     add dword ecx, 0xc
00515aaf  4e                           dec esi
00515ab0  8b 18                        mov ebx, [eax]
00515ab2  89 1f                        mov [edi], ebx
00515ab4  8b 58 04                     mov ebx, [eax+0x4]
00515ab7  89 5f 04                     mov [edi+0x4], ebx
00515aba  8b 40 08                     mov eax, [eax+0x8]
00515abd  89 47 08                     mov [edi+0x8], eax
00515ac0  75 da                        jnz short 0x515a9c

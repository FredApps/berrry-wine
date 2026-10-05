; mw3-gameplay-02-0x00515a9c
; runtime 0x00515a9c  module mech3demo.exe  orig 0x00515a9c
; entries 356061  guest ops 15  retired 5340915  2.85% of window

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

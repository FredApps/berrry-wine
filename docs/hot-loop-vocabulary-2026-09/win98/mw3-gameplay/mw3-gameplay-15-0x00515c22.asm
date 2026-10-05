; mw3-gameplay-15-0x00515c22
; runtime 0x00515c22  module mech3demo.exe  orig 0x00515c22
; entries 109492  guest ops 15  retired 1642380  0.88% of window

00515c22  8b 02                        mov eax, [edx]
00515c24  8b 7d f8                     mov edi, [ebp-0x8]
00515c27  83 c2 04                     add dword edx, 0x4
00515c2a  8d 04 40                     lea eax, [eax+eax*2]
00515c2d  8d 04 87                     lea eax, [edi+eax*4]
00515c30  8b f9                        mov edi, ecx
00515c32  83 c1 0c                     add dword ecx, 0xc
00515c35  4e                           dec esi
00515c36  8b 18                        mov ebx, [eax]
00515c38  89 1f                        mov [edi], ebx
00515c3a  8b 58 04                     mov ebx, [eax+0x4]
00515c3d  89 5f 04                     mov [edi+0x4], ebx
00515c40  8b 40 08                     mov eax, [eax+0x8]
00515c43  89 47 08                     mov [edi+0x8], eax
00515c46  75 da                        jnz short 0x515c22

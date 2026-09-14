; mw3long-02-0x00527075
; runtime 0x00527075  module mech3demo.exe  orig 0x00527075
; entries 3062399  guest ops 38  retired 116371162  44.25% of window

00527075  33 d2                        xor edx, edx
00527077  33 f6                        xor esi, esi
00527079  66 8b 51 fe                  mov dx, [ecx-0x2]
0052707d  66 8b 71 02                  mov si, [ecx+0x2]
00527081  8b d8                        mov ebx, eax
00527083  8b e8                        mov ebp, eax
00527085  23 da                        and ebx, edx
00527087  23 ee                        and ebp, esi
00527089  33 ff                        xor edi, edi
0052708b  03 dd                        add ebx, ebp
0052708d  66 8b 39                     mov di, [ecx]
00527090  8b e8                        mov ebp, eax
00527092  23 ef                        and ebp, edi
00527094  83 c1 02                     add dword ecx, 0x2
00527097  8d 1c 6b                     lea ebx, [ebx+ebp*2]
0052709a  8b 6c 24 14                  mov ebp, [esp+0x14]
0052709e  23 ea                        and ebp, edx
005270a0  8b 54 24 14                  mov edx, [esp+0x14]
005270a4  23 d6                        and edx, esi
005270a6  03 ea                        add ebp, edx
005270a8  8b 54 24 14                  mov edx, [esp+0x14]
005270ac  8b f2                        mov esi, edx
005270ae  23 f7                        and esi, edi
005270b0  c1 eb 02                     shr ebx, 0x2
005270b3  8d 74 75 00                  lea esi, [ebp+esi*2+0x0]
005270b7  c1 ee 02                     shr esi, 0x2
005270ba  23 f2                        and esi, edx
005270bc  8b d0                        mov edx, eax
005270be  23 d3                        and edx, ebx
005270c0  0b f2                        or esi, edx
005270c2  8b 54 24 18                  mov edx, [esp+0x18]
005270c6  66 89 32                     mov [edx], si
005270c9  8b 74 24 28                  mov esi, [esp+0x28]
005270cd  83 c2 02                     add dword edx, 0x2
005270d0  4e                           dec esi
005270d1  89 54 24 18                  mov [esp+0x18], edx
005270d5  89 74 24 28                  mov [esp+0x28], esi
005270d9  75 9a                        jnz short 0x527075

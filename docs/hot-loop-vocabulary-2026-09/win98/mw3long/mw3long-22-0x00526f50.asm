; mw3long-22-0x00526f50
; runtime 0x00526f50  module mech3demo.exe  orig 0x00526f50
; entries 4780  guest ops 43  retired 205540  0.08% of window

00526f50  89 5c 24 20                  mov [esp+0x20], ebx
00526f54  8b 54 24 28                  mov edx, [esp+0x28]
00526f58  8b f1                        mov esi, ecx
00526f5a  8b d8                        mov ebx, eax
00526f5c  8b e8                        mov ebp, eax
00526f5e  8d 3c 12                     lea edi, [edx+edx]
00526f61  33 d2                        xor edx, edx
00526f63  2b f7                        sub esi, edi
00526f65  83 c1 02                     add dword ecx, 0x2
00526f68  66 8b 16                     mov dx, [esi]
00526f6b  33 f6                        xor esi, esi
00526f6d  66 8b 74 39 fe               mov si, [ecx+edi-0x2]
00526f72  23 da                        and ebx, edx
00526f74  23 ee                        and ebp, esi
00526f76  33 ff                        xor edi, edi
00526f78  66 8b 79 fe                  mov di, [ecx-0x2]
00526f7c  03 dd                        add ebx, ebp
00526f7e  8b e8                        mov ebp, eax
00526f80  23 ef                        and ebp, edi
00526f82  8d 1c 6b                     lea ebx, [ebx+ebp*2]
00526f85  8b 6c 24 14                  mov ebp, [esp+0x14]
00526f89  23 ea                        and ebp, edx
00526f8b  8b 54 24 14                  mov edx, [esp+0x14]
00526f8f  23 d6                        and edx, esi
00526f91  03 ea                        add ebp, edx
00526f93  8b 54 24 14                  mov edx, [esp+0x14]
00526f97  8b f2                        mov esi, edx
00526f99  23 f7                        and esi, edi
00526f9b  c1 eb 02                     shr ebx, 0x2
00526f9e  8d 74 75 00                  lea esi, [ebp+esi*2+0x0]
00526fa2  c1 ee 02                     shr esi, 0x2
00526fa5  23 f2                        and esi, edx
00526fa7  8b d0                        mov edx, eax
00526fa9  23 d3                        and edx, ebx
00526fab  0b f2                        or esi, edx
00526fad  8b 54 24 18                  mov edx, [esp+0x18]
00526fb1  66 89 32                     mov [edx], si
00526fb4  8b 74 24 20                  mov esi, [esp+0x20]
00526fb8  83 c2 02                     add dword edx, 0x2
00526fbb  4e                           dec esi
00526fbc  89 54 24 18                  mov [esp+0x18], edx
00526fc0  89 74 24 20                  mov [esp+0x20], esi
00526fc4  75 8e                        jnz short 0x526f54

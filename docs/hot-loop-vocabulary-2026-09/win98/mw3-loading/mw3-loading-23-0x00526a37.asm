; mw3-loading-23-0x00526a37
; runtime 0x00526a37  module mech3demo.exe  orig 0x00526a37
; entries 122108  guest ops 46  retired 5616968  0.45% of window

00526a37  2b c2                        sub eax, edx
00526a39  8b d6                        mov edx, esi
00526a3b  2b d1                        sub edx, ecx
00526a3d  66 8b 0c 43                  mov cx, [ebx+eax*2]
00526a41  8b 45 fc                     mov eax, [ebp-0x4]
00526a44  66 89 0c 50                  mov [eax+edx*2], cx
00526a48  8b d6                        mov edx, esi
00526a4a  0f af 15 6c c6 6e 00         imul edx, [0x6ec66c]
00526a51  8b ce                        mov ecx, esi
00526a53  2b d7                        sub edx, edi
00526a55  0f af 0d 60 c6 6e 00         imul ecx, [0x6ec660]
00526a5c  66 8b 14 53                  mov dx, [ebx+edx*2]
00526a60  2b cf                        sub ecx, edi
00526a62  66 89 14 48                  mov [eax+ecx*2], dx
00526a66  8b cf                        mov ecx, edi
00526a68  0f af 0d 6c c6 6e 00         imul ecx, [0x6ec66c]
00526a6f  03 ce                        add ecx, esi
00526a71  8b d3                        mov edx, ebx
00526a73  d1 e1                        shl ecx, 1
00526a75  2b d1                        sub edx, ecx
00526a77  8b cf                        mov ecx, edi
00526a79  0f af 0d 60 c6 6e 00         imul ecx, [0x6ec660]
00526a80  66 8b 12                     mov dx, [edx]
00526a83  03 ce                        add ecx, esi
00526a85  d1 e1                        shl ecx, 1
00526a87  2b c1                        sub eax, ecx
00526a89  8b cb                        mov ecx, ebx
00526a8b  66 89 10                     mov [eax], dx
00526a8e  8b c6                        mov eax, esi
00526a90  0f af 05 6c c6 6e 00         imul eax, [0x6ec66c]
00526a97  8b d6                        mov edx, esi
00526a99  03 c7                        add eax, edi
00526a9b  0f af 15 60 c6 6e 00         imul edx, [0x6ec660]
00526aa2  d1 e0                        shl eax, 1
00526aa4  03 d7                        add edx, edi
00526aa6  2b c8                        sub ecx, eax
00526aa8  8b 45 fc                     mov eax, [ebp-0x4]
00526aab  66 8b 09                     mov cx, [ecx]
00526aae  d1 e2                        shl edx, 1
00526ab0  2b c2                        sub eax, edx
00526ab2  66 89 08                     mov [eax], cx
00526ab5  8b 45 08                     mov eax, [ebp+0x8]
00526ab8  46                           inc esi
00526ab9  3b f0                        cmp esi, eax
00526abb  89 75 18                     mov [ebp+0x18], esi
00526abe  0f 8e ec fc ff ff            jle 0x5267b0

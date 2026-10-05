; mw3-loading-17-0x005269d6
; runtime 0x005269d6  module mech3demo.exe  orig 0x005269d6
; entries 122108  guest ops 48  retired 5861184  0.47% of window
; TRUNCATED at --max-ops: no terminator within the window

005269d6  66 8b 14 53                  mov dx, [ebx+edx*2]
005269da  03 cf                        add ecx, edi
005269dc  66 89 14 48                  mov [eax+ecx*2], dx
005269e0  8b cf                        mov ecx, edi
005269e2  0f af 0d 6c c6 6e 00         imul ecx, [0x6ec66c]
005269e9  8b d7                        mov edx, edi
005269eb  2b ce                        sub ecx, esi
005269ed  0f af 15 60 c6 6e 00         imul edx, [0x6ec660]
005269f4  66 8b 0c 4b                  mov cx, [ebx+ecx*2]
005269f8  2b d6                        sub edx, esi
005269fa  66 89 0c 50                  mov [eax+edx*2], cx
005269fe  8b d6                        mov edx, esi
00526a00  0f af 15 6c c6 6e 00         imul edx, [0x6ec66c]
00526a07  8b ce                        mov ecx, esi
00526a09  8b c7                        mov eax, edi
00526a0b  0f af 0d 60 c6 6e 00         imul ecx, [0x6ec660]
00526a12  2b c2                        sub eax, edx
00526a14  8b d7                        mov edx, edi
00526a16  2b d1                        sub edx, ecx
00526a18  8b 4d fc                     mov ecx, [ebp-0x4]
00526a1b  66 8b 04 43                  mov ax, [ebx+eax*2]
00526a1f  66 89 04 51                  mov [ecx+edx*2], ax
00526a23  8b d7                        mov edx, edi
00526a25  0f af 15 6c c6 6e 00         imul edx, [0x6ec66c]
00526a2c  8b cf                        mov ecx, edi
00526a2e  8b c6                        mov eax, esi
00526a30  0f af 0d 60 c6 6e 00         imul ecx, [0x6ec660]
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

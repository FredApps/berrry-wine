; quake2-loading-18-0x00419b9b
; runtime 0x00419b9b  module quake2.exe  orig 0x00419b9b
; entries 32229  guest ops 48  retired 1546992  0.56% of window
; TRUNCATED at --max-ops: no terminator within the window

00419b9b  8b 54 24 60                  mov edx, [esp+0x60]
00419b9f  8b cb                        mov ecx, ebx
00419ba1  8b c5                        mov eax, ebp
00419ba3  83 c4 0c                     add dword esp, 0xc
00419ba6  f7 d1                        not ecx
00419ba8  23 c3                        and eax, ebx
00419baa  23 ca                        and ecx, edx
00419bac  8b 54 24 10                  mov edx, [esp+0x10]
00419bb0  0b c1                        or eax, ecx
00419bb2  03 c2                        add eax, edx
00419bb4  8b 4c 24 14                  mov ecx, [esp+0x14]
00419bb8  03 f0                        add esi, eax
00419bba  89 74 24 58                  mov [esp+0x58], esi
00419bbe  8b 54 24 58                  mov edx, [esp+0x58]
00419bc2  c1 ee 1d                     shr esi, 0x1d
00419bc5  8d 04 d5 00 00 00 00         lea eax, [0x0+edx*8]
00419bcc  8b d3                        mov edx, ebx
00419bce  0b f0                        or esi, eax
00419bd0  8b c6                        mov eax, esi
00419bd2  23 d6                        and edx, esi
00419bd4  f7 d0                        not eax
00419bd6  23 c5                        and eax, ebp
00419bd8  0b d0                        or edx, eax
00419bda  03 d1                        add edx, ecx
00419bdc  8b 4c 24 54                  mov ecx, [esp+0x54]
00419be0  03 ca                        add ecx, edx
00419be2  8b c1                        mov eax, ecx
00419be4  c1 e8 19                     shr eax, 0x19
00419be7  c1 e1 07                     shl ecx, 0x7
00419bea  0b c1                        or eax, ecx
00419bec  8b d0                        mov edx, eax
00419bee  8b c8                        mov ecx, eax
00419bf0  f7 d2                        not edx
00419bf2  23 ce                        and ecx, esi
00419bf4  23 d3                        and edx, ebx
00419bf6  0b ca                        or ecx, edx
00419bf8  8b 54 24 18                  mov edx, [esp+0x18]
00419bfc  03 ca                        add ecx, edx
00419bfe  8b d0                        mov edx, eax
00419c00  03 e9                        add ebp, ecx
00419c02  8b cd                        mov ecx, ebp
00419c04  c1 e9 15                     shr ecx, 0x15
00419c07  c1 e5 0b                     shl ebp, 0xb
00419c0a  0b cd                        or ecx, ebp
00419c0c  8b e9                        mov ebp, ecx
00419c0e  23 d1                        and edx, ecx
00419c10  f7 d5                        not ebp
00419c12  23 ee                        and ebp, esi

; quake2-loading-19-0x00419e17
; runtime 0x00419e17  module quake2.exe  orig 0x00419e17
; entries 32229  guest ops 48  retired 1546992  0.56% of window
; TRUNCATED at --max-ops: no terminator within the window

00419e17  0b d0                        or edx, eax
00419e19  23 e8                        and ebp, eax
00419e1b  23 d3                        and edx, ebx
00419e1d  0b d5                        or edx, ebp
00419e1f  8b 6c 24 40                  mov ebp, [esp+0x40]
00419e23  03 d5                        add edx, ebp
00419e25  8b e9                        mov ebp, ecx
00419e27  8d b4 16 99 79 82 5a         lea esi, [esi+edx+0x5a827999]
00419e2e  8b d6                        mov edx, esi
00419e30  c1 ea 13                     shr edx, 0x13
00419e33  c1 e6 0d                     shl esi, 0xd
00419e36  0b d6                        or edx, esi
00419e38  8b f1                        mov esi, ecx
00419e3a  0b ea                        or ebp, edx
00419e3c  23 f2                        and esi, edx
00419e3e  23 eb                        and ebp, ebx
00419e40  89 74 24 54                  mov [esp+0x54], esi
00419e44  0b ee                        or ebp, esi
00419e46  8b 74 24 14                  mov esi, [esp+0x14]
00419e4a  03 ee                        add ebp, esi
00419e4c  8d b4 28 99 79 82 5a         lea esi, [eax+ebp+0x5a827999]
00419e53  8b e9                        mov ebp, ecx
00419e55  8b c6                        mov eax, esi
00419e57  c1 e8 1d                     shr eax, 0x1d
00419e5a  c1 e6 03                     shl esi, 0x3
00419e5d  0b c6                        or eax, esi
00419e5f  8b f2                        mov esi, edx
00419e61  23 f0                        and esi, eax
00419e63  23 e8                        and ebp, eax
00419e65  89 74 24 58                  mov [esp+0x58], esi
00419e69  0b ee                        or ebp, esi
00419e6b  8b 74 24 54                  mov esi, [esp+0x54]
00419e6f  0b ee                        or ebp, esi
00419e71  8b 74 24 24                  mov esi, [esp+0x24]
00419e75  03 ee                        add ebp, esi
00419e77  8d 9c 2b 99 79 82 5a         lea ebx, [ebx+ebp+0x5a827999]
00419e7e  8b 6c 24 58                  mov ebp, [esp+0x58]
00419e82  8b f3                        mov esi, ebx
00419e84  c1 ee 1b                     shr esi, 0x1b
00419e87  c1 e3 05                     shl ebx, 0x5
00419e8a  0b f3                        or esi, ebx
00419e8c  8b da                        mov ebx, edx
00419e8e  0b d8                        or ebx, eax
00419e90  23 de                        and ebx, esi
00419e92  0b dd                        or ebx, ebp
00419e94  8b 6c 24 34                  mov ebp, [esp+0x34]
00419e98  03 dd                        add ebx, ebp
00419e9a  8d 9c 19 99 79 82 5a         lea ebx, [ecx+ebx+0x5a827999]

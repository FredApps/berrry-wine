; mw3-loading-05-0x00526563
; runtime 0x00526563  module mech3demo.exe  orig 0x00526563
; entries 1778386  guest ops 12  retired 21340632  1.72% of window

00526563  0f af 05 60 c6 6e 00         imul eax, [0x6ec660]
0052656a  03 ca                        add ecx, edx
0052656c  8b 15 5c c6 6e 00            mov edx, [0x6ec65c]
00526572  03 c7                        add eax, edi
00526574  66 8b 0c 4a                  mov cx, [edx+ecx*2]
00526578  8b 15 58 c6 6e 00            mov edx, [0x6ec658]
0052657e  66 89 0c 42                  mov [edx+eax*2], cx
00526582  5f                           pop edi
00526583  5e                           pop esi
00526584  5d                           pop ebp
00526585  5b                           pop ebx
00526586  c2 08 00                     ret 0x8

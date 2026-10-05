; mw3-gameplay-14-0x00518f8c
; runtime 0x00518f8c  module mech3demo.exe  orig 0x00518f8c
; entries 235474  guest ops 7  retired 1648318  0.88% of window

00518f8c  0f bf 10                     movsx edx, word [eax]
00518f8f  83 e2 fe                     and dword edx, -0x2
00518f92  83 e8 02                     sub dword eax, 0x2
00518f95  49                           dec ecx
00518f96  66 8b 54 14 24               mov dx, [esp+edx+0x24]
00518f9b  66 89 50 02                  mov [eax+0x2], dx
00518f9f  75 eb                        jnz short 0x518f8c

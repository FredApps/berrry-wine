; mw3long-12-0x00559daf
; runtime 0x00559daf  module mech3demo.exe  orig 0x00559daf
; entries 50471  guest ops 7  retired 353297  0.13% of window

00559daf  8b 96 44 01 00 00            mov edx, [esi+0x144]
00559db5  33 c9                        xor ecx, ecx
00559db7  85 d2                        test edx, edx
00559db9  0f 94 c1                     setz cl
00559dbc  84 c9                        test cl, cl
00559dbe  c7 45 ec 01 00 00 00         mov dword [ebp-0x14], 0x1
00559dc5  0f 85 58 02 00 00            jnz 0x55a023

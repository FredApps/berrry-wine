; mw3-21-0x0054827c
; runtime 0x0054827c  module mech3demo.exe  orig 0x0054827c
; entries 5375  guest ops 20  retired 107500  1.01% of window

0054827c  db 02                        fild dword [edx]
0054827e  d9 15 4c 57 7c 00            fst dword [0x7c574c]
00548284  d9 1d ec 56 7c 00            fstp dword [0x7c56ec]
0054828a  db 42 08                     fild dword [edx+0x8]
0054828d  d9 15 2c 57 7c 00            fst dword [0x7c572c]
00548293  d9 1d 0c 57 7c 00            fstp dword [0x7c570c]
00548299  db 42 04                     fild dword [edx+0x4]
0054829c  d9 15 10 57 7c 00            fst dword [0x7c5710]
005482a2  d9 1d f0 56 7c 00            fstp dword [0x7c56f0]
005482a8  db 42 0c                     fild dword [edx+0xc]
005482ab  d9 15 50 57 7c 00            fst dword [0x7c5750]
005482b1  d9 1d 30 57 7c 00            fstp dword [0x7c5730]
005482b7  8b 0d 64 e8 7b 00            mov ecx, [0x7be864]
005482bd  8b f7                        mov esi, edi
005482bf  dd 44 24 14                  fld qword [esp+0x14]
005482c3  dc 0d e0 90 59 00            fmul qword [0x5990e0]
005482c9  23 f1                        and esi, ecx
005482cb  8b 0d 70 e8 7b 00            mov ecx, [0x7be870]
005482d1  d3 ee                        shr esi, cl
005482d3  e8 c8 f3 02 00               call 0x5776a0

; quake2-loading-22-0x004267fd
; runtime 0x004267fd  module quake2.exe  orig 0x004267fd
; entries 239453  guest ops 6  retired 1436718  0.52% of window

004267fd  c1 e2 10                     shl edx, 0x10
00426800  25 ff ff 00 00               and eax, 0xffff
00426805  0b d0                        or edx, eax
00426807  3e 89 54 4f fc               ds: mov [edi+ecx*2-0x4], edx
0042680c  83 e9 02                     sub dword ecx, 0x2
0042680f  75 a6                        jnz short 0x4267b7

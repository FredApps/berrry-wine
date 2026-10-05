; caesar3-03-0x00417213
; runtime 0x00417213  module c3.exe  orig 0x00417213
; entries 4546755  guest ops 5  retired 22733775  7.05% of window

00417213  8b 55 f8                     mov edx, [ebp-0x8]
00417216  c1 e2 07                     shl edx, 0x7
00417219  8b 45 f0                     mov eax, [ebp-0x10]
0041721c  c7 84 82 6c 64 86 00 00 00 00 00 mov dword [edx+eax*4+0x86646c], 0x0
00417227  eb db                        jmp short 0x417204

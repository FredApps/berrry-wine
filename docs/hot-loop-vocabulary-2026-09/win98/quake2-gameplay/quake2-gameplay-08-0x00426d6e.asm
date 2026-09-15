; quake2-gameplay-08-0x00426d6e
; runtime 0x00426d6e  module quake2.exe  orig 0x00426d6e
; entries 2700817  guest ops 16  retired 43213072  1.45% of window

00426d6e  3e 8b 3c 98                  ds: mov edi, [eax+ebx*4]
00426d72  3e 8b 2c 9a                  ds: mov ebp, [edx+ebx*4]
00426d76  3e 03 3c cd 58 b7 4a 00      ds: add edi, [0x4ab758+ecx*8]
00426d7e  3e 03 2c cd 5c b7 4a 00      ds: add ebp, [0x4ab75c+ecx*8]
00426d86  3e 8a 5c 0e fe               ds: mov bl, [esi+ecx-0x2]
00426d8b  3e 89 3c cd 58 b7 4a 00      ds: mov [0x4ab758+ecx*8], edi
00426d93  3e 89 2c cd 5c b7 4a 00      ds: mov [0x4ab75c+ecx*8], ebp
00426d9b  3e 8b 3c 98                  ds: mov edi, [eax+ebx*4]
00426d9f  3e 8b 2c 9a                  ds: mov ebp, [edx+ebx*4]
00426da3  3e 8a 5c 0e fd               ds: mov bl, [esi+ecx-0x3]
00426da8  3e 03 3c cd 50 b7 4a 00      ds: add edi, [0x4ab750+ecx*8]
00426db0  3e 03 2c cd 54 b7 4a 00      ds: add ebp, [0x4ab754+ecx*8]
00426db8  3e 89 3c cd 50 b7 4a 00      ds: mov [0x4ab750+ecx*8], edi
00426dc0  3e 89 2c cd 54 b7 4a 00      ds: mov [0x4ab754+ecx*8], ebp
00426dc8  83 e9 02                     sub dword ecx, 0x2
00426dcb  75 a1                        jnz short 0x426d6e

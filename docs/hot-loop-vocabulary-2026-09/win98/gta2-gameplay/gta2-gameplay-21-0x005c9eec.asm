; gta2-gameplay-21-0x005c9eec
; runtime 0x005c9eec  module gta2.exe  orig 0x005c9eec
; entries 13046  guest ops 37  retired 482702  0.78% of window

005c9eec  db 44 24 4c                  fild dword [esp+0x4c]
005c9ef0  8b 54 24 4c                  mov edx, [esp+0x4c]
005c9ef4  c7 05 b8 6b 6f 00 17 b7 d1 38 mov dword [0x6f6bb8], 0x38d1b717
005c9efe  03 da                        add ebx, edx
005c9f00  8b 54 24 34                  mov edx, [esp+0x34]
005c9f04  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9f0a  89 5c 24 4c                  mov [esp+0x4c], ebx
005c9f0e  03 c2                        add eax, edx
005c9f10  c7 05 d8 6b 6f 00 17 b7 d1 38 mov dword [0x6f6bd8], 0x38d1b717
005c9f1a  c7 05 f8 6b 6f 00 17 b7 d1 38 mov dword [0x6f6bf8], 0x38d1b717
005c9f24  c7 05 18 6c 6f 00 17 b7 d1 38 mov dword [0x6f6c18], 0x38d1b717
005c9f2e  d9 15 b0 6b 6f 00            fst dword [0x6f6bb0]
005c9f34  db 44 24 34                  fild dword [esp+0x34]
005c9f38  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9f3e  d9 15 b4 6b 6f 00            fst dword [0x6f6bb4]
005c9f44  db 44 24 4c                  fild dword [esp+0x4c]
005c9f48  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9f4e  d9 54 24 4c                  fst dword [esp+0x4c]
005c9f52  d9 1d d0 6b 6f 00            fstp dword [0x6f6bd0]
005c9f58  8b 4c 24 4c                  mov ecx, [esp+0x4c]
005c9f5c  89 44 24 4c                  mov [esp+0x4c], eax
005c9f60  d9 1d d4 6b 6f 00            fstp dword [0x6f6bd4]
005c9f66  db 44 24 4c                  fild dword [esp+0x4c]
005c9f6a  33 c0                        xor eax, eax
005c9f6c  89 0d f0 6b 6f 00            mov [0x6f6bf0], ecx
005c9f72  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9f78  d9 c0                        fld st(0)
005c9f7a  d9 1d f4 6b 6f 00            fstp dword [0x6f6bf4]
005c9f80  d9 c9                        fxch st(1)
005c9f82  d9 1d 10 6c 6f 00            fstp dword [0x6f6c10]
005c9f88  d9 1d 14 6c 6f 00            fstp dword [0x6f6c14]
005c9f8e  8a 46 04                     mov al, [esi+0x4]
005c9f91  89 44 24 4c                  mov [esp+0x4c], eax
005c9f95  db 44 24 4c                  fild dword [esp+0x4c]
005c9f99  d8 25 e8 0c 5f 00            fsub dword [0x5f0ce8]
005c9f9f  d8 0d f0 0c 5f 00            fmul dword [0x5f0cf0]
005c9fa5  e8 96 4b 01 00               call 0x5deb40

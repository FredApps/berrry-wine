; gta2-gameplay-x87-80-0x005c936d
; runtime 0x005c936d  module gta2.exe  orig 0x005c936d
; entries 666  guest ops 29  retired 19314  0.20% of window

005c936d  8b 00                        mov eax, [eax]
005c936f  c7 05 d8 6b 6f 00 17 b7 d1 38 mov dword [0x6f6bd8], 0x38d1b717
005c9379  8b 4c 24 2c                  mov ecx, [esp+0x2c]
005c937d  8b 6c 24 4c                  mov ebp, [esp+0x4c]
005c9381  03 cd                        add ecx, ebp
005c9383  8b 54 24 50                  mov edx, [esp+0x50]
005c9387  89 4c 24 6c                  mov [esp+0x6c], ecx
005c938b  8b 8e c8 77 65 00            mov ecx, [esi+0x6577c8]
005c9391  db 44 24 6c                  fild dword [esp+0x6c]
005c9395  03 c2                        add eax, edx
005c9397  8b 96 c0 8f 65 00            mov edx, [esi+0x658fc0]
005c939d  89 44 24 6c                  mov [esp+0x6c], eax
005c93a1  8b 44 24 10                  mov eax, [esp+0x10]
005c93a5  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c93ab  89 44 24 30                  mov [esp+0x30], eax
005c93af  89 4c 24 4c                  mov [esp+0x4c], ecx
005c93b3  8d 44 24 4c                  lea eax, [esp+0x4c]
005c93b7  8d 4c 24 28                  lea ecx, [esp+0x28]
005c93bb  d9 1d d0 6b 6f 00            fstp dword [0x6f6bd0]
005c93c1  db 44 24 6c                  fild dword [esp+0x6c]
005c93c5  50                           push eax
005c93c6  51                           push ecx
005c93c7  8d 4c 24 38                  lea ecx, [esp+0x38]
005c93cb  89 5c 24 34                  mov [esp+0x34], ebx
005c93cf  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c93d5  89 54 24 74                  mov [esp+0x74], edx
005c93d9  89 5c 24 5c                  mov [esp+0x5c], ebx
005c93dd  d9 1d d4 6b 6f 00            fstp dword [0x6f6bd4]
005c93e3  e8 b8 f0 e3 ff               call 0x4084a0

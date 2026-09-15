; gta2-gameplay-x87-85-0x005c944d
; runtime 0x005c944d  module gta2.exe  orig 0x005c944d
; entries 666  guest ops 28  retired 18648  0.19% of window

005c944d  8b 00                        mov eax, [eax]
005c944f  c7 05 f8 6b 6f 00 17 b7 d1 38 mov dword [0x6f6bf8], 0x38d1b717
005c9459  8b 4c 24 2c                  mov ecx, [esp+0x2c]
005c945d  8b 5c 24 50                  mov ebx, [esp+0x50]
005c9461  03 cd                        add ecx, ebp
005c9463  8b 54 24 10                  mov edx, [esp+0x10]
005c9467  89 4c 24 6c                  mov [esp+0x6c], ecx
005c946b  03 c3                        add eax, ebx
005c946d  db 44 24 6c                  fild dword [esp+0x6c]
005c9471  8b 8e c0 8f 65 00            mov ecx, [esi+0x658fc0]
005c9477  89 44 24 6c                  mov [esp+0x6c], eax
005c947b  8b 86 c8 77 65 00            mov eax, [esi+0x6577c8]
005c9481  89 54 24 30                  mov [esp+0x30], edx
005c9485  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c948b  89 44 24 50                  mov [esp+0x50], eax
005c948f  8d 54 24 50                  lea edx, [esp+0x50]
005c9493  8d 44 24 54                  lea eax, [esp+0x54]
005c9497  52                           push edx
005c9498  d9 1d f0 6b 6f 00            fstp dword [0x6f6bf0]
005c949e  db 44 24 70                  fild dword [esp+0x70]
005c94a2  89 4c 24 70                  mov [esp+0x70], ecx
005c94a6  50                           push eax
005c94a7  8d 4c 24 38                  lea ecx, [esp+0x38]
005c94ab  89 7c 24 34                  mov [esp+0x34], edi
005c94af  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c94b5  89 7c 24 54                  mov [esp+0x54], edi
005c94b9  d9 1d f4 6b 6f 00            fstp dword [0x6f6bf4]
005c94bf  e8 dc ef e3 ff               call 0x4084a0

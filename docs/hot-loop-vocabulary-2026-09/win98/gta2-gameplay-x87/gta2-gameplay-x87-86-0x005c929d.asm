; gta2-gameplay-x87-86-0x005c929d
; runtime 0x005c929d  module gta2.exe  orig 0x005c929d
; entries 666  guest ops 27  retired 17982  0.18% of window

005c929d  8b 00                        mov eax, [eax]
005c929f  c7 05 b8 6b 6f 00 17 b7 d1 38 mov dword [0x6f6bb8], 0x38d1b717
005c92a9  8b 54 24 2c                  mov edx, [esp+0x2c]
005c92ad  8b 4c 24 4c                  mov ecx, [esp+0x4c]
005c92b1  03 d1                        add edx, ecx
005c92b3  8b 8e c0 8f 65 00            mov ecx, [esi+0x658fc0]
005c92b9  89 54 24 6c                  mov [esp+0x6c], edx
005c92bd  8b 54 24 50                  mov edx, [esp+0x50]
005c92c1  db 44 24 6c                  fild dword [esp+0x6c]
005c92c5  03 c2                        add eax, edx
005c92c7  8d 54 24 54                  lea edx, [esp+0x54]
005c92cb  89 44 24 6c                  mov [esp+0x6c], eax
005c92cf  8b 86 c8 77 65 00            mov eax, [esi+0x6577c8]
005c92d5  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c92db  89 44 24 54                  mov [esp+0x54], eax
005c92df  89 5c 24 2c                  mov [esp+0x2c], ebx
005c92e3  89 6c 24 30                  mov [esp+0x30], ebp
005c92e7  52                           push edx
005c92e8  d9 1d b0 6b 6f 00            fstp dword [0x6f6bb0]
005c92ee  db 44 24 70                  fild dword [esp+0x70]
005c92f2  89 4c 24 70                  mov [esp+0x70], ecx
005c92f6  8d 44 24 2c                  lea eax, [esp+0x2c]
005c92fa  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9300  d9 1d b4 6b 6f 00            fstp dword [0x6f6bb4]
005c9306  50                           push eax
005c9307  8d 4c 24 38                  lea ecx, [esp+0x38]
005c930b  e8 90 f1 e3 ff               call 0x4084a0

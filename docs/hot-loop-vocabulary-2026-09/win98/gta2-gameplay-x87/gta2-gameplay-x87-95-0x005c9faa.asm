; gta2-gameplay-x87-95-0x005c9faa
; runtime 0x005c9faa  module gta2.exe  orig 0x005c9faa
; entries 2124  guest ops 8  retired 16992  0.17% of window

005c9faa  33 c9                        xor ecx, ecx
005c9fac  89 44 24 24                  mov [esp+0x24], eax
005c9fb0  8a 4e 05                     mov cl, [esi+0x5]
005c9fb3  89 4c 24 4c                  mov [esp+0x4c], ecx
005c9fb7  db 44 24 4c                  fild dword [esp+0x4c]
005c9fbb  d8 25 e8 0c 5f 00            fsub dword [0x5f0ce8]
005c9fc1  d8 0d f0 0c 5f 00            fmul dword [0x5f0cf0]
005c9fc7  e8 74 4b 01 00               call 0x5deb40

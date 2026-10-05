; gta2-gameplay-10-0x004d71e5
; runtime 0x004d71e5  module gta2.exe  orig 0x004d71e5
; entries 120078  guest ops 8  retired 960624  1.55% of window

004d71e5  8a 96 6b 03 00 00            mov dl, [esi+0x36b]
004d71eb  8b f8                        mov edi, eax
004d71ed  8a 86 6a 03 00 00            mov al, [esi+0x36a]
004d71f3  88 54 24 10                  mov [esp+0x10], dl
004d71f7  8a 4f 01                     mov cl, [edi+0x1]
004d71fa  88 44 24 0c                  mov [esp+0xc], al
004d71fe  3a c1                        cmp al, cl
004d7200  72 42                        jb short 0x4d7244

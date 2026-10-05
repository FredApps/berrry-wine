; gta2-loading-07-0x005ca062
; runtime 0x005ca062  module gta2.exe  orig 0x005ca062
; entries 9756  guest ops 10  retired 97560  1.69% of window

005ca062  be 08 00 00 00               mov esi, 0x8
005ca067  8b 4c 24 38                  mov ecx, [esp+0x38]
005ca06b  8b 7c 24 18                  mov edi, [esp+0x18]
005ca06f  8b 6c 24 44                  mov ebp, [esp+0x44]
005ca073  89 5c 24 4c                  mov [esp+0x4c], ebx
005ca077  8b 5c 24 3c                  mov ebx, [esp+0x3c]
005ca07b  83 c7 02                     add dword edi, 0x2
005ca07e  89 7c 24 18                  mov [esp+0x18], edi
005ca082  66 83 3f 00                  cmp word [edi], 0x0
005ca086  0f 85 da fc ff ff            jnz 0x5c9d66

; diablo-03-0x007be0b5
; runtime 0x007be0b5  module storm.dll  orig 0x1501d0b5
; entries 7136486  guest ops 15  retired 107047290  7.27% of window

1501d0b5  8b 44 24 18                  mov eax, [esp+0x18]
1501d0b9  8b 6c 24 2c                  mov ebp, [esp+0x2c]
1501d0bd  c7 44 24 14 00 00 00 00      mov dword [esp+0x14], 0x0
1501d0c5  89 44 24 28                  mov [esp+0x28], eax
1501d0c9  40                           inc eax
1501d0ca  89 44 24 18                  mov [esp+0x18], eax
1501d0ce  8b c5                        mov eax, ebp
1501d0d0  33 c5                        xor eax, ebp
1501d0d2  8b 6c 24 28                  mov ebp, [esp+0x28]
1501d0d6  89 44 24 2c                  mov [esp+0x2c], eax
1501d0da  8a 44 24 4c                  mov al, [esp+0x4c]
1501d0de  38 45 00                     cmp [ebp+0x0], al
1501d0e1  0f 95 44 24 2c               setnz [esp+0x2c]
1501d0e6  39 7c 24 2c                  cmp [esp+0x2c], edi
1501d0ea  75 0c                        jnz short 0x1501d0f8

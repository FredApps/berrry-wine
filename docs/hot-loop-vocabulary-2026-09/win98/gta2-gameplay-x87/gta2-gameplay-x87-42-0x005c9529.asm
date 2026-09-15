; gta2-gameplay-x87-42-0x005c9529
; runtime 0x005c9529  module gta2.exe  orig 0x005c9529
; entries 666  guest ops 60  retired 39960  0.41% of window

005c9529  8b 00                        mov eax, [eax]
005c952b  33 c9                        xor ecx, ecx
005c952d  8b 54 24 2c                  mov edx, [esp+0x2c]
005c9531  89 44 24 30                  mov [esp+0x30], eax
005c9535  03 d5                        add edx, ebp
005c9537  03 c3                        add eax, ebx
005c9539  89 54 24 6c                  mov [esp+0x6c], edx
005c953d  c7 05 18 6c 6f 00 17 b7 d1 38 mov dword [0x6f6c18], 0x38d1b717
005c9547  db 44 24 6c                  fild dword [esp+0x6c]
005c954b  89 44 24 6c                  mov [esp+0x6c], eax
005c954f  8b 44 24 18                  mov eax, [esp+0x18]
005c9553  33 d2                        xor edx, edx
005c9555  68 ff 00 00 00               push 0xff
005c955a  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9560  68 b0 6b 6f 00               push 0x6f6bb0
005c9565  d9 1d 10 6c 6f 00            fstp dword [0x6f6c10]
005c956b  db 44 24 74                  fild dword [esp+0x74]
005c956f  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9575  d9 1d 14 6c 6f 00            fstp dword [0x6f6c14]
005c957b  8a 48 04                     mov cl, [eax+0x4]
005c957e  8a 50 05                     mov dl, [eax+0x5]
005c9581  89 4c 24 74                  mov [esp+0x74], ecx
005c9585  89 54 24 58                  mov [esp+0x58], edx
005c9589  db 44 24 74                  fild dword [esp+0x74]
005c958d  db 44 24 58                  fild dword [esp+0x58]
005c9591  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c9597  d9 ca                        fxch st(2)
005c9599  d8 25 e8 0c 5f 00            fsub dword [0x5f0ce8]
005c959f  d9 c9                        fxch st(1)
005c95a1  d8 25 e8 0c 5f 00            fsub dword [0x5f0ce8]
005c95a7  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c95ad  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c95b3  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c95b9  d9 cc                        fxch st(4)
005c95bb  d9 54 24 74                  fst dword [esp+0x74]
005c95bf  d9 c3                        fld st(3)
005c95c1  d9 ce                        fxch st(6)
005c95c3  d9 1d c8 6b 6f 00            fstp dword [0x6f6bc8]
005c95c9  d9 ca                        fxch st(2)
005c95cb  d9 1d cc 6b 6f 00            fstp dword [0x6f6bcc]
005c95d1  d9 c9                        fxch st(1)
005c95d3  d9 1d e8 6b 6f 00            fstp dword [0x6f6be8]
005c95d9  8b 44 24 74                  mov eax, [esp+0x74]
005c95dd  8b 4c 24 64                  mov ecx, [esp+0x64]
005c95e1  d9 1d ec 6b 6f 00            fstp dword [0x6f6bec]
005c95e7  d9 ca                        fxch st(2)
005c95e9  d9 1d 0c 6c 6f 00            fstp dword [0x6f6c0c]
005c95ef  a3 08 6c 6f 00               mov [0x6f6c08], eax
005c95f4  8b 44 24 68                  mov eax, [esp+0x68]
005c95f8  d9 1d 28 6c 6f 00            fstp dword [0x6f6c28]
005c95fe  50                           push eax
005c95ff  d9 1d 2c 6c 6f 00            fstp dword [0x6f6c2c]
005c9605  8b 11                        mov edx, [ecx]
005c9607  8b 4c 24 54                  mov ecx, [esp+0x54]
005c960b  52                           push edx
005c960c  8b 54 24 54                  mov edx, [esp+0x54]
005c9610  51                           push ecx
005c9611  8b 0d 0c 4f 6f 00            mov ecx, [0x6f4f0c]
005c9617  52                           push edx
005c9618  e8 83 1e fe ff               call 0x5ab4a0

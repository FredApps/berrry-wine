; mw3long-08-0x005634cc
; runtime 0x005634cc  module mech3demo.exe  orig 0x005634cc
; entries 50470  guest ops 8  retired 403760  0.15% of window

005634cc  89 44 24 04                  mov [esp+0x4], eax
005634d0  c7 44 24 08 00 00 00 00      mov dword [esp+0x8], 0x0
005634d8  df 6c 24 04                  fild word [esp+0x4]
005634dc  83 ec 08                     sub dword esp, 0x8
005634df  8b ce                        mov ecx, esi
005634e1  d8 0d f0 9c 59 00            fmul dword [0x599cf0]
005634e7  dd 1c 24                     fstp qword [esp]
005634ea  e8 01 ff ff ff               call 0x5633f0

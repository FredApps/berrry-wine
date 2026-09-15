; gta2-loading-03-0x005c9fcc
; runtime 0x005c9fcc  module gta2.exe  orig 0x005c9fcc
; entries 9757  guest ops 36  retired 351252  6.09% of window

005c9fcc  db 44 24 24                  fild dword [esp+0x24]
005c9fd0  89 44 24 4c                  mov [esp+0x4c], eax
005c9fd4  68 ff 00 00 00               push 0xff
005c9fd9  db 44 24 50                  fild dword [esp+0x50]
005c9fdd  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c9fe3  d9 ca                        fxch st(2)
005c9fe5  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9feb  d9 c9                        fxch st(1)
005c9fed  d8 0d e4 0c 5f 00            fmul dword [0x5f0ce4]
005c9ff3  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c9ff9  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005c9fff  d9 05 ec 0c 5f 00            fld dword [0x5f0cec]
005ca005  d9 cd                        fxch st(5)
005ca007  d9 1d c8 6b 6f 00            fstp dword [0x6f6bc8]
005ca00d  d9 c3                        fld st(3)
005ca00f  d9 ca                        fxch st(2)
005ca011  d9 1d cc 6b 6f 00            fstp dword [0x6f6bcc]
005ca017  d9 ca                        fxch st(2)
005ca019  d9 54 24 50                  fst dword [esp+0x50]
005ca01d  d9 44 24 50                  fld dword [esp+0x50]
005ca021  d9 ca                        fxch st(2)
005ca023  d9 1d e8 6b 6f 00            fstp dword [0x6f6be8]
005ca029  d9 ca                        fxch st(2)
005ca02b  d9 1d ec 6b 6f 00            fstp dword [0x6f6bec]
005ca031  8b 54 24 14                  mov edx, [esp+0x14]
005ca035  8b 44 24 18                  mov eax, [esp+0x18]
005ca039  d9 ca                        fxch st(2)
005ca03b  d9 1d 08 6c 6f 00            fstp dword [0x6f6c08]
005ca041  68 b0 6b 6f 00               push 0x6f6bb0
005ca046  52                           push edx
005ca047  d9 1d 0c 6c 6f 00            fstp dword [0x6f6c0c]
005ca04d  d9 c9                        fxch st(1)
005ca04f  d9 1d 28 6c 6f 00            fstp dword [0x6f6c28]
005ca055  50                           push eax
005ca056  d9 1d 2c 6c 6f 00            fstp dword [0x6f6c2c]
005ca05c  ff 15 c0 59 61 00            call [0x6159c0]

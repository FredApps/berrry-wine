; quake2-gameplay-x87-67-0x00d8ff82
; runtime 0x00d8ff82  module ref_soft.dll  orig 0x10011f82
; entries 31559  guest ops 17  retired 536503  0.27% of window

10011f82  89 0d 00 7b 02 10            mov [0x10027b00], ecx
10011f88  db 05 00 7b 02 10            fild dword [0x10027b00]
10011f8e  d9 05 84 7a 02 10            fld dword [0x10027a84]
10011f94  d8 c9                        fmul st, st(1)
10011f96  d9 05 80 7a 02 10            fld dword [0x10027a80]
10011f9c  d8 ca                        fmul st, st(2)
10011f9e  d9 c9                        fxch st(1)
10011fa0  de c3                        faddp st(3), st
10011fa2  d9 c9                        fxch st(1)
10011fa4  d8 0d 7c 7a 02 10            fmul dword [0x10027a7c]
10011faa  d9 c9                        fxch st(1)
10011fac  de c3                        faddp st(3), st
10011fae  d9 05 5c 7a 02 10            fld dword [0x10027a5c]
10011fb4  d9 c9                        fxch st(1)
10011fb6  de c4                        faddp st(4), st
10011fb8  d8 f1                        fdiv st, st(1)
10011fba  eb 20                        jmp short 0x10011fdc

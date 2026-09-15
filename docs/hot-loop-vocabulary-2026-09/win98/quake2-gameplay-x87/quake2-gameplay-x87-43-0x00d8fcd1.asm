; quake2-gameplay-x87-43-0x00d8fcd1
; runtime 0x00d8fcd1  module ref_soft.dll  orig 0x10011cd1
; entries 39062  guest ops 25  retired 976550  0.50% of window

10011cd1  89 0d 00 7b 02 10            mov [0x10027b00], ecx
10011cd7  d9 c9                        fxch st(1)
10011cd9  d9 c0                        fld st(0)
10011cdb  d8 cc                        fmul st, st(4)
10011cdd  d9 c9                        fxch st(1)
10011cdf  d8 cb                        fmul st, st(3)
10011ce1  d9 c9                        fxch st(1)
10011ce3  db 1d cc 7a 02 10            fistp dword [0x10027acc]
10011ce9  db 1d d0 7a 02 10            fistp dword [0x10027ad0]
10011cef  db 05 00 7b 02 10            fild dword [0x10027b00]
10011cf5  d9 05 80 7a 02 10            fld dword [0x10027a80]
10011cfb  d9 05 84 7a 02 10            fld dword [0x10027a84]
10011d01  d8 ca                        fmul st, st(2)
10011d03  d9 c9                        fxch st(1)
10011d05  d8 ca                        fmul st, st(2)
10011d07  d9 ca                        fxch st(2)
10011d09  d8 0d 7c 7a 02 10            fmul dword [0x10027a7c]
10011d0f  d9 c9                        fxch st(1)
10011d11  de c3                        faddp st(3), st
10011d13  d9 c9                        fxch st(1)
10011d15  de c3                        faddp st(3), st
10011d17  de c3                        faddp st(3), st
10011d19  d9 05 5c 7a 02 10            fld dword [0x10027a5c]
10011d1f  d8 f1                        fdiv st, st(1)
10011d21  eb 55                        jmp short 0x10011d78

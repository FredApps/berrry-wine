; quake2-gameplay-x87-51-0x00d8fd40
; runtime 0x00d8fd40  module ref_soft.dll  orig 0x10011d40
; entries 34056  guest ops 22  retired 749232  0.38% of window

10011d40  d9 c9                        fxch st(1)
10011d42  d9 c0                        fld st(0)
10011d44  d8 cc                        fmul st, st(4)
10011d46  d9 c9                        fxch st(1)
10011d48  d8 cb                        fmul st, st(3)
10011d4a  d9 c9                        fxch st(1)
10011d4c  db 1d cc 7a 02 10            fistp dword [0x10027acc]
10011d52  db 1d d0 7a 02 10            fistp dword [0x10027ad0]
10011d58  d8 05 f4 7a 02 10            fadd dword [0x10027af4]
10011d5e  d9 ca                        fxch st(2)
10011d60  d8 05 f8 7a 02 10            fadd dword [0x10027af8]
10011d66  d9 ca                        fxch st(2)
10011d68  d9 05 fc 7a 02 10            fld dword [0x10027afc]
10011d6e  de c2                        faddp st(2), st
10011d70  d9 05 5c 7a 02 10            fld dword [0x10027a5c]
10011d76  d8 f1                        fdiv st, st(1)
10011d78  03 35 cc 7a 02 10            add esi, [0x10027acc]
10011d7e  03 15 d0 7a 02 10            add edx, [0x10027ad0]
10011d84  8b 1d a8 7a 02 10            mov ebx, [0x10027aa8]
10011d8a  8b 2d ac 7a 02 10            mov ebp, [0x10027aac]
10011d90  3b f3                        cmp esi, ebx
10011d92  0f 87 e7 fd ff ff            ja 0x10011b7f

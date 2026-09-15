; quake2-gameplay-11-0x00d8fdeb
; runtime 0x00d8fdeb  module ref_soft.dll  orig 0x10011deb
; entries 1684609  guest ops 21  retired 35376789  1.19% of window

10011deb  d9 c0                        fld st(0)
10011ded  d8 cc                        fmul st, st(4)
10011def  d9 c9                        fxch st(1)
10011df1  d8 cb                        fmul st, st(3)
10011df3  d9 c9                        fxch st(1)
10011df5  db 1d d4 7a 02 10            fistp dword [0x10027ad4]
10011dfb  db 1d d8 7a 02 10            fistp dword [0x10027ad8]
10011e01  a1 d4 7a 02 10               mov eax, [0x10027ad4]
10011e06  8b 15 d8 7a 02 10            mov edx, [0x10027ad8]
10011e0c  8a 1e                        mov bl, [esi]
10011e0e  83 e9 10                     sub dword ecx, 0x10
10011e11  8b 2d a0 7a 02 10            mov ebp, [0x10027aa0]
10011e17  89 0d b0 7b 02 10            mov [0x10027bb0], ecx
10011e1d  8b 0d a4 7a 02 10            mov ecx, [0x10027aa4]
10011e23  88 1f                        mov [edi], bl
10011e25  03 e8                        add ebp, eax
10011e27  03 ca                        add ecx, edx
10011e29  a1 a8 7a 02 10               mov eax, [0x10027aa8]
10011e2e  8b 15 ac 7a 02 10            mov edx, [0x10027aac]
10011e34  81 fd 00 10 00 00            cmp dword ebp, 0x1000
10011e3a  0f 8c 5c fd ff ff            jl 0x10011b9c

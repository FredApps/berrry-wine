; quake2-gameplay-x87-29-0x00d900bd
; runtime 0x00d900bd  module ref_soft.dll  orig 0x100120bd
; entries 70621  guest ops 17  retired 1200557  0.61% of window

100120bd  d9 c0                        fld st(0)
100120bf  d8 cc                        fmul st, st(4)
100120c1  d9 c9                        fxch st(1)
100120c3  d8 cb                        fmul st, st(3)
100120c5  d9 c9                        fxch st(1)
100120c7  db 1d d4 7a 02 10            fistp dword [0x10027ad4]
100120cd  db 1d d8 7a 02 10            fistp dword [0x10027ad8]
100120d3  8a 06                        mov al, [esi]
100120d5  8b 1d a4 7a 02 10            mov ebx, [0x10027aa4]
100120db  88 07                        mov [edi], al
100120dd  a1 a0 7a 02 10               mov eax, [0x10027aa0]
100120e2  03 05 d4 7a 02 10            add eax, [0x10027ad4]
100120e8  03 1d d8 7a 02 10            add ebx, [0x10027ad8]
100120ee  8b 2d a8 7a 02 10            mov ebp, [0x10027aa8]
100120f4  8b 15 ac 7a 02 10            mov edx, [0x10027aac]
100120fa  3d 00 10 00 00               cmp eax, 0x1000
100120ff  0f 8c c1 fa ff ff            jl 0x10011bc6

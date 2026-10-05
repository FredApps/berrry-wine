; quake2-gameplay-x87-34-0x00d8b920
; runtime 0x00d8b920  module ref_soft.dll  orig 0x1000d920
; entries 18020  guest ops 64  retired 1153280  0.58% of window
; TRUNCATED at --max-ops: no terminator within the window

1000d920  55                           push ebp
1000d921  8b ec                        mov ebp, esp
1000d923  53                           push ebx
1000d924  56                           push esi
1000d925  57                           push edi
1000d926  a1 80 45 03 10               mov eax, [0x10034580]
1000d92b  8b 1d 84 45 03 10            mov ebx, [0x10034584]
1000d931  2b 05 c0 45 03 10            sub eax, [0x100345c0]
1000d937  2b 1d c4 45 03 10            sub ebx, [0x100345c4]
1000d93d  a3 94 e2 02 10               mov [0x1002e294], eax
1000d942  89 1d 8c e2 02 10            mov [0x1002e28c], ebx
1000d948  db 05 94 e2 02 10            fild dword [0x1002e294]
1000d94e  db 05 8c e2 02 10            fild dword [0x1002e28c]
1000d954  a1 a0 45 03 10               mov eax, [0x100345a0]
1000d959  8b 1d a4 45 03 10            mov ebx, [0x100345a4]
1000d95f  2b 05 c0 45 03 10            sub eax, [0x100345c0]
1000d965  2b 1d c4 45 03 10            sub ebx, [0x100345c4]
1000d96b  d9 1d 8c e2 02 10            fstp dword [0x1002e28c]
1000d971  d9 1d 94 e2 02 10            fstp dword [0x1002e294]
1000d977  a3 88 e2 02 10               mov [0x1002e288], eax
1000d97c  89 1d ac e2 02 10            mov [0x1002e2ac], ebx
1000d982  db 05 88 e2 02 10            fild dword [0x1002e288]
1000d988  db 05 ac e2 02 10            fild dword [0x1002e2ac]
1000d98e  d9 1d ac e2 02 10            fstp dword [0x1002e2ac]
1000d994  d9 1d 88 e2 02 10            fstp dword [0x1002e288]
1000d99a  d9 2d 78 19 03 10            fldcw dword [0x10031978]
1000d9a0  db 05 0c 45 03 10            fild dword [0x1003450c]
1000d9a6  d8 3d 00 64 02 10            fdivr dword [0x10026400]
1000d9ac  d9 15 b0 e2 02 10            fst dword [0x1002e2b0]
1000d9b2  d8 0d 04 64 02 10            fmul dword [0x10026404]
1000d9b8  a1 90 45 03 10               mov eax, [0x10034590]
1000d9bd  8b 1d b0 45 03 10            mov ebx, [0x100345b0]
1000d9c3  2b 05 d0 45 03 10            sub eax, [0x100345d0]
1000d9c9  2b 1d d0 45 03 10            sub ebx, [0x100345d0]
1000d9cf  d9 1d 90 e2 02 10            fstp dword [0x1002e290]
1000d9d5  a3 98 e2 02 10               mov [0x1002e298], eax
1000d9da  89 1d a8 e2 02 10            mov [0x1002e2a8], ebx
1000d9e0  db 05 98 e2 02 10            fild dword [0x1002e298]
1000d9e6  db 05 a8 e2 02 10            fild dword [0x1002e2a8]
1000d9ec  d9 c9                        fxch st(1)
1000d9ee  d9 1d 9c e2 02 10            fstp dword [0x1002e29c]
1000d9f4  d9 15 a0 e2 02 10            fst dword [0x1002e2a0]
1000d9fa  d8 0d 8c e2 02 10            fmul dword [0x1002e28c]
1000da00  d9 05 9c e2 02 10            fld dword [0x1002e29c]
1000da06  d8 0d ac e2 02 10            fmul dword [0x1002e2ac]
1000da0c  d9 05 a0 e2 02 10            fld dword [0x1002e2a0]
1000da12  d8 0d 94 e2 02 10            fmul dword [0x1002e294]
1000da18  d9 05 9c e2 02 10            fld dword [0x1002e29c]
1000da1e  d8 0d 88 e2 02 10            fmul dword [0x1002e288]
1000da24  d9 ca                        fxch st(2)
1000da26  de eb                        fsubp st(3), st
1000da28  de e1                        fsubrp st(1), st
1000da2a  d9 c9                        fxch st(1)
1000da2c  d8 0d b0 e2 02 10            fmul dword [0x1002e2b0]
1000da32  d9 c9                        fxch st(1)
1000da34  d8 0d 90 e2 02 10            fmul dword [0x1002e290]
1000da3a  d9 c9                        fxch st(1)
1000da3c  db 1d 70 4d 03 10            fistp dword [0x10034d70]
1000da42  db 1d 74 4d 03 10            fistp dword [0x10034d74]
1000da48  d9 2d 88 19 03 10            fldcw dword [0x10031988]
1000da4e  a1 88 45 03 10               mov eax, [0x10034588]
1000da53  8b 1d a8 45 03 10            mov ebx, [0x100345a8]
1000da59  2b 05 c8 45 03 10            sub eax, [0x100345c8]
1000da5f  2b 1d c8 45 03 10            sub ebx, [0x100345c8]

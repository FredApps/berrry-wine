; gta2-gameplay-x87-79-0x005919b0
; runtime 0x005919b0  module gta2.exe  orig 0x005919b0
; entries 304  guest ops 64  retired 19456  0.20% of window
; TRUNCATED at --max-ops: no terminator within the window

005919b0  8b 75 04                     mov esi, [ebp+0x4]
005919b3  8b 45 1c                     mov eax, [ebp+0x1c]
005919b6  83 c6 0c                     add dword esi, 0xc
005919b9  05 80 00 00 00               add eax, 0x80
005919be  33 d2                        xor edx, edx
005919c0  33 c9                        xor ecx, ecx
005919c2  db 46 04                     fild dword [esi+0x4]
005919c5  22 c2                        and al, dl
005919c7  8a 4b 04                     mov cl, [ebx+0x4]
005919ca  89 44 24 20                  mov [esp+0x20], eax
005919ce  8a 53 05                     mov dl, [ebx+0x5]
005919d1  db 44 24 20                  fild dword [esp+0x20]
005919d5  db 06                        fild dword [esi]
005919d7  d9 ca                        fxch st(2)
005919d9  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
005919df  d9 c9                        fxch st(1)
005919e1  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
005919e7  d9 ca                        fxch st(2)
005919e9  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
005919ef  d9 c1                        fld st(1)
005919f1  d9 cb                        fxch st(3)
005919f3  d9 54 24 14                  fst dword [esp+0x14]
005919f7  d9 44 24 14                  fld dword [esp+0x14]
005919fb  d9 ca                        fxch st(2)
005919fd  d9 1d a8 34 6f 00            fstp dword [0x6f34a8]
00591a03  a1 28 69 66 00               mov eax, [0x666928]
00591a08  89 4c 24 20                  mov [esp+0x20], ecx
00591a0c  d9 cb                        fxch st(3)
00591a0e  d9 1d ac 34 6f 00            fstp dword [0x6f34ac]
00591a14  d9 ca                        fxch st(2)
00591a16  d9 1d b0 34 6f 00            fstp dword [0x6f34b0]
00591a1c  db 80 a0 00 00 00            fild dword [eax+0xa0]
00591a22  d9 ca                        fxch st(2)
00591a24  dc 2d e8 0b 5f 00            fsubr qword [0x5f0be8]
00591a2a  d9 ca                        fxch st(2)
00591a2c  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591a32  d9 ca                        fxch st(2)
00591a34  dd d9                        fstp st(1)
00591a36  d9 c9                        fxch st(1)
00591a38  d8 c1                        fadd st, st(1)
00591a3a  db 44 24 20                  fild dword [esp+0x20]
00591a3e  d9 c9                        fxch st(1)
00591a40  dc 3d f0 0b 5f 00            fdivr qword [0x5f0bf0]
00591a46  89 54 24 20                  mov [esp+0x20], edx
00591a4a  33 ff                        xor edi, edi
00591a4c  89 7c 24 1c                  mov [esp+0x1c], edi
00591a50  d9 1d 30 34 6f 00            fstp dword [0x6f3430]
00591a56  db 06                        fild dword [esi]
00591a58  db 80 98 00 00 00            fild dword [eax+0x98]
00591a5e  db 40 60                     fild dword [eax+0x60]
00591a61  d9 ca                        fxch st(2)
00591a63  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591a69  d9 c9                        fxch st(1)
00591a6b  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591a71  d9 ca                        fxch st(2)
00591a73  d8 0d e0 0b 5f 00            fmul dword [0x5f0be0]
00591a79  d9 ca                        fxch st(2)
00591a7b  de e9                        fsubp st(1), st
00591a7d  d9 c9                        fxch st(1)
00591a7f  8b 48 70                     mov ecx, [eax+0x70]
00591a82  de c9                        fmulp st(1), st
00591a84  db 44 24 20                  fild dword [esp+0x20]
00591a88  89 4c 24 18                  mov [esp+0x18], ecx
00591a8c  df 6c 24 18                  fild word [esp+0x18]

; quake2-gameplay-06-0x00d8ffbc
; runtime 0x00d8ffbc  module ref_soft.dll  orig 0x10011fbc
; entries 1039250  guest ops 48  retired 49884000  1.68% of window
; TRUNCATED at --max-ops: no terminator within the window

10011fbc  d8 05 f4 7a 02 10            fadd dword [0x10027af4]
10011fc2  d9 ca                        fxch st(2)
10011fc4  d8 05 f8 7a 02 10            fadd dword [0x10027af8]
10011fca  d9 ca                        fxch st(2)
10011fcc  d9 05 fc 7a 02 10            fld dword [0x10027afc]
10011fd2  de c2                        faddp st(2), st
10011fd4  d9 05 5c 7a 02 10            fld dword [0x10027a5c]
10011fda  d8 f1                        fdiv st, st(1)
10011fdc  89 0d b0 7b 02 10            mov [0x10027bb0], ecx
10011fe2  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011fe8  1b c9                        sbb ecx, ecx
10011fea  88 47 08                     mov [edi+0x8], al
10011fed  03 dd                        add ebx, ebp
10011fef  8a 06                        mov al, [esi]
10011ff1  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011ff8  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011ffe  1b c9                        sbb ecx, ecx
10012000  88 47 09                     mov [edi+0x9], al
10012003  03 dd                        add ebx, ebp
10012005  8a 06                        mov al, [esi]
10012007  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
1001200e  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10012014  1b c9                        sbb ecx, ecx
10012016  88 47 0a                     mov [edi+0xa], al
10012019  03 dd                        add ebx, ebp
1001201b  8a 06                        mov al, [esi]
1001201d  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10012024  03 15 a8 7b 02 10            add edx, [0x10027ba8]
1001202a  1b c9                        sbb ecx, ecx
1001202c  88 47 0b                     mov [edi+0xb], al
1001202f  03 dd                        add ebx, ebp
10012031  8a 06                        mov al, [esi]
10012033  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
1001203a  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10012040  1b c9                        sbb ecx, ecx
10012042  88 47 0c                     mov [edi+0xc], al
10012045  03 dd                        add ebx, ebp
10012047  8a 06                        mov al, [esi]
10012049  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10012050  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10012056  1b c9                        sbb ecx, ecx
10012058  88 47 0d                     mov [edi+0xd], al
1001205b  03 dd                        add ebx, ebp
1001205d  8a 06                        mov al, [esi]
1001205f  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10012066  03 15 a8 7b 02 10            add edx, [0x10027ba8]
1001206c  1b c9                        sbb ecx, ecx
1001206e  88 47 0e                     mov [edi+0xe], al

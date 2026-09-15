; quake2-gameplay-04-0x00d90000
; runtime 0x00d90000  module ref_soft.dll  orig 0x10012000
; entries 1684609  guest ops 45  retired 75807405  2.55% of window

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
10012071  03 dd                        add ebx, ebp
10012073  8a 06                        mov al, [esi]
10012075  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
1001207c  83 c7 10                     add dword edi, 0x10
1001207f  89 15 e0 7a 02 10            mov [0x10027ae0], edx
10012085  8b 15 d4 7a 02 10            mov edx, [0x10027ad4]
1001208b  89 1d dc 7a 02 10            mov [0x10027adc], ebx
10012091  8b 1d d8 7a 02 10            mov ebx, [0x10027ad8]
10012097  89 15 cc 7a 02 10            mov [0x10027acc], edx
1001209d  89 1d d0 7a 02 10            mov [0x10027ad0], ebx
100120a3  8b 0d b0 7b 02 10            mov ecx, [0x10027bb0]
100120a9  83 f9 10                     cmp dword ecx, 0x10
100120ac  88 47 ff                     mov [edi-0x1], al
100120af  0f 87 36 fd ff ff            ja 0x10011deb

; quake2-gameplay-20-0x00d9042f
; runtime 0x00d9042f  module ref_soft.dll  orig 0x1001242f
; entries 870907  guest ops 27  retired 23514489  0.79% of window

1001242f  1b c9                        sbb ecx, ecx
10012431  88 47 0b                     mov [edi+0xb], al
10012434  03 dd                        add ebx, ebp
10012436  8a 06                        mov al, [esi]
10012438  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
1001243f  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10012445  1b c9                        sbb ecx, ecx
10012447  88 47 0c                     mov [edi+0xc], al
1001244a  03 dd                        add ebx, ebp
1001244c  8a 06                        mov al, [esi]
1001244e  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10012455  03 15 a8 7b 02 10            add edx, [0x10027ba8]
1001245b  1b c9                        sbb ecx, ecx
1001245d  88 47 0d                     mov [edi+0xd], al
10012460  03 dd                        add ebx, ebp
10012462  8a 06                        mov al, [esi]
10012464  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
1001246b  88 47 0e                     mov [edi+0xe], al
1001246e  8a 06                        mov al, [esi]
10012470  dd d8                        fstp st(0)
10012472  dd d8                        fstp st(0)
10012474  dd d8                        fstp st(0)
10012476  8b 1d ac 7b 02 10            mov ebx, [0x10027bac]
1001247c  8b 5b 0c                     mov ebx, [ebx+0xc]
1001247f  85 db                        test ebx, ebx
10012481  88 47 0f                     mov [edi+0xf], al
10012484  0f 85 b1 f7 ff ff            jnz 0x10011c3b

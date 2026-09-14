; quake2-17-0x00d8fe94
; runtime 0x00d8fe94  module ref_soft.dll  orig 0x10011e94
; entries 77137  guest ops 48  retired 3702576  1.01% of window
; TRUNCATED at --max-ops: no terminator within the window

10011e94  03 c2                        add eax, edx
10011e96  8b 15 e0 7a 02 10            mov edx, [0x10027ae0]
10011e9c  a3 a0 7b 02 10               mov [0x10027ba0], eax
10011ea1  03 c3                        add eax, ebx
10011ea3  c1 e5 0c                     shl ebp, 0xc
10011ea6  8b 1d dc 7a 02 10            mov ebx, [0x10027adc]
10011eac  c1 e1 0c                     shl ecx, 0xc
10011eaf  a3 9c 7b 02 10               mov [0x10027b9c], eax
10011eb4  89 0d a8 7b 02 10            mov [0x10027ba8], ecx
10011eba  03 d1                        add edx, ecx
10011ebc  1b c9                        sbb ecx, ecx
10011ebe  03 dd                        add ebx, ebp
10011ec0  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011ec7  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011ecd  1b c9                        sbb ecx, ecx
10011ecf  8a 06                        mov al, [esi]
10011ed1  03 dd                        add ebx, ebp
10011ed3  88 47 01                     mov [edi+0x1], al
10011ed6  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011edd  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011ee3  1b c9                        sbb ecx, ecx
10011ee5  03 dd                        add ebx, ebp
10011ee7  8a 06                        mov al, [esi]
10011ee9  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011ef0  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011ef6  1b c9                        sbb ecx, ecx
10011ef8  88 47 02                     mov [edi+0x2], al
10011efb  03 dd                        add ebx, ebp
10011efd  8a 06                        mov al, [esi]
10011eff  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011f06  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011f0c  1b c9                        sbb ecx, ecx
10011f0e  88 47 03                     mov [edi+0x3], al
10011f11  03 dd                        add ebx, ebp
10011f13  8a 06                        mov al, [esi]
10011f15  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011f1c  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011f22  1b c9                        sbb ecx, ecx
10011f24  88 47 04                     mov [edi+0x4], al
10011f27  03 dd                        add ebx, ebp
10011f29  8a 06                        mov al, [esi]
10011f2b  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
10011f32  03 15 a8 7b 02 10            add edx, [0x10027ba8]
10011f38  1b c9                        sbb ecx, ecx
10011f3a  88 47 05                     mov [edi+0x5], al
10011f3d  03 dd                        add ebx, ebp
10011f3f  8a 06                        mov al, [esi]
10011f41  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]

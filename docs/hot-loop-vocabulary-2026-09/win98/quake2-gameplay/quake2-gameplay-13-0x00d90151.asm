; quake2-gameplay-13-0x00d90151
; runtime 0x00d90151  module ref_soft.dll  orig 0x10012151
; entries 1331131  guest ops 23  retired 30616013  1.03% of window

10012151  8b 1c 8d 44 7b 02 10         mov ebx, [0x10027b44+ecx*4]
10012158  8b c2                        mov eax, edx
1001215a  89 1d b4 7b 02 10            mov [0x10027bb4], ebx
10012160  8b cd                        mov ecx, ebp
10012162  c1 fa 10                     sar edx, 0x10
10012165  8b 1d b4 7a 02 10            mov ebx, [0x10027ab4]
1001216b  c1 f9 10                     sar ecx, 0x10
1001216e  0f af d3                     imul edx, ebx
10012171  03 d1                        add edx, ecx
10012173  8b 0d e0 7a 02 10            mov ecx, [0x10027ae0]
10012179  89 15 a0 7b 02 10            mov [0x10027ba0], edx
1001217f  03 d3                        add edx, ebx
10012181  c1 e5 10                     shl ebp, 0x10
10012184  8b 1d dc 7a 02 10            mov ebx, [0x10027adc]
1001218a  c1 e0 10                     shl eax, 0x10
1001218d  89 15 9c 7b 02 10            mov [0x10027b9c], edx
10012193  a3 a8 7b 02 10               mov [0x10027ba8], eax
10012198  8b d1                        mov edx, ecx
1001219a  03 d0                        add edx, eax
1001219c  1b c9                        sbb ecx, ecx
1001219e  03 dd                        add ebx, ebp
100121a0  13 34 8d a0 7b 02 10         adc esi, [0x10027ba0+ecx*4]
100121a7  ff 25 b4 7b 02 10            jmp [0x10027bb4]

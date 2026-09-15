; quake2-gameplay-09-0x00d9012f
; runtime 0x00d9012f  module ref_soft.dll  orig 0x1001212f
; entries 1211824  guest ops 31  retired 37566544  1.26% of window

1001212f  2b 05 cc 7a 02 10            sub eax, [0x10027acc]
10012135  2b 1d d0 7a 02 10            sub ebx, [0x10027ad0]
1001213b  03 c0                        add eax, eax
1001213d  03 db                        add ebx, ebx
1001213f  f7 2c 8d 04 7b 02 10         imul [0x10027b04+ecx*4]
10012146  8b ea                        mov ebp, edx
10012148  8b c3                        mov eax, ebx
1001214a  f7 2c 8d 04 7b 02 10         imul [0x10027b04+ecx*4]
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

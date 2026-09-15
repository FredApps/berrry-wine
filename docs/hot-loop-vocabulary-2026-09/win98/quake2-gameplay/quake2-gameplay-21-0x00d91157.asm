; quake2-gameplay-21-0x00d91157
; runtime 0x00d91157  module ref_soft.dll  orig 0x10013157
; entries 845579  guest ops 27  retired 22830633  0.77% of window

10013157  8b 0d 60 4d 03 10            mov ecx, [0x10034d60]
1001315d  8b 15 08 86 11 10            mov edx, [0x10118608]
10013163  89 0d a0 7b 02 10            mov [0x10027ba0], ecx
10013169  03 ca                        add ecx, edx
1001316b  89 0d 9c 7b 02 10            mov [0x10027b9c], ecx
10013171  8b 0d 64 45 03 10            mov ecx, [0x10034564]
10013177  66 8b 0d 70 4d 03 10         mov cx, [0x10034d70]
1001317e  8b d0                        mov edx, eax
10013180  89 0d a8 7b 02 10            mov [0x10027ba8], ecx
10013186  83 c2 07                     add dword edx, 0x7
10013189  c1 ea 03                     shr edx, 0x3
1001318c  8b 5e 10                     mov ebx, [esi+0x10]
1001318f  66 8b da                     mov bx, dx
10013192  8b 4e 04                     mov ecx, [esi+0x4]
10013195  f7 d8                        neg eax
10013197  8b 3e                        mov edi, [esi]
10013199  83 e0 07                     and dword eax, 0x7
1001319c  2b f8                        sub edi, eax
1001319e  2b c8                        sub ecx, eax
100131a0  2b c8                        sub ecx, eax
100131a2  8b 56 14                     mov edx, [esi+0x14]
100131a5  66 8b 56 18                  mov dx, [esi+0x18]
100131a9  8b 6e 1c                     mov ebp, [esi+0x1c]
100131ac  c1 cd 10                     ror ebp, 0x10
100131af  56                           push esi
100131b0  8b 76 0c                     mov esi, [esi+0xc]
100131b3  ff 24 85 98 79 02 10         jmp [0x10027998+eax*4]

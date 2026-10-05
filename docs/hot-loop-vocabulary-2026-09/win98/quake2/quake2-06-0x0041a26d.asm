; quake2-06-0x0041a26d
; runtime 0x0041a26d  module quake2.exe  orig 0x0041a26d
; entries 516382  guest ops 17  retired 8778494  2.39% of window

0041a26d  33 c9                        xor ecx, ecx
0041a26f  33 d2                        xor edx, edx
0041a271  8a 68 01                     mov ch, [eax+0x1]
0041a274  8a 50 ff                     mov dl, [eax-0x1]
0041a277  8a 08                        mov cl, [eax]
0041a279  83 c0 04                     add dword eax, 0x4
0041a27c  c1 e1 08                     shl ecx, 0x8
0041a27f  0b ca                        or ecx, edx
0041a281  33 d2                        xor edx, edx
0041a283  8a 50 fa                     mov dl, [eax-0x6]
0041a286  83 c6 04                     add dword esi, 0x4
0041a289  c1 e1 08                     shl ecx, 0x8
0041a28c  0b ca                        or ecx, edx
0041a28e  89 4e fc                     mov [esi-0x4], ecx
0041a291  8d 0c 07                     lea ecx, [edi+eax]
0041a294  3b cd                        cmp ecx, ebp
0041a296  72 d5                        jb short 0x41a26d

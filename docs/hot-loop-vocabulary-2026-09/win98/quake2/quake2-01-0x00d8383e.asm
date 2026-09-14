; quake2-01-0x00d8383e
; runtime 0x00d8383e  module ref_soft.dll  orig 0x1000583e
; entries 1724441  guest ops 22  retired 37937702  10.33% of window

1000583e  8d 3c 2b                     lea edi, [ebx+ebp]
10005841  8a d8                        mov bl, al
10005843  8d 71 01                     lea esi, [ecx+0x1]
10005846  8a fb                        mov bh, bl
10005848  8b ce                        mov ecx, esi
1000584a  8b c3                        mov eax, ebx
1000584c  8b d1                        mov edx, ecx
1000584e  c1 e0 10                     shl eax, 0x10
10005851  66 8b c3                     mov ax, bx
10005854  8b 5c 24 18                  mov ebx, [esp+0x18]
10005858  c1 e9 02                     shr ecx, 0x2
1000585b  f3 ab                        rep stosd
1000585d  8b ca                        mov ecx, edx
1000585f  83 e1 03                     and dword ecx, 0x3
10005862  03 ee                        add ebp, esi
10005864  f3 aa                        rep stosb
10005866  8b 54 24 10                  mov edx, [esp+0x10]
1000586a  8b 4c 24 14                  mov ecx, [esp+0x14]
1000586e  33 c0                        xor eax, eax
10005870  66 8b 41 08                  mov ax, [ecx+0x8]
10005874  3b e8                        cmp ebp, eax
10005876  7e 94                        jle short 0x1000580c

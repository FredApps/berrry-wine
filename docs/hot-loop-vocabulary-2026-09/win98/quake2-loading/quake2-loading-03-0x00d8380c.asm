; quake2-loading-03-0x00d8380c
; runtime 0x00d8380c  module ref_soft.dll  orig 0x1000580c
; entries 1724441  guest ops 8  retired 13795528  5.02% of window

1000580c  33 c0                        xor eax, eax
1000580e  8a 02                        mov al, [edx]
10005810  42                           inc edx
10005811  8b c8                        mov ecx, eax
10005813  89 54 24 10                  mov [esp+0x10], edx
10005817  81 e1 c0 00 00 00            and dword ecx, 0xc0
1000581d  80 f9 c0                     cmp byte cl, 0xc0
10005820  75 10                        jnz short 0x10005832

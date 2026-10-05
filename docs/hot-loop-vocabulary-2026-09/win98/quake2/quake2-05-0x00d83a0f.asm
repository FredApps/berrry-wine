; quake2-05-0x00d83a0f
; runtime 0x00d83a0f  module ref_soft.dll  orig 0x10005a0f
; entries 1990546  guest ops 5  retired 9952730  2.71% of window

10005a0f  8b 7b 54                     mov edi, [ebx+0x54]
10005a12  41                           inc ecx
10005a13  3b ce                        cmp ecx, esi
10005a15  88 44 39 ff                  mov [ecx+edi-0x1], al
10005a19  7c e5                        jl short 0x10005a00

; quake2-loading-20-0x0041a000
; runtime 0x0041a000  module quake2.exe  orig 0x0041a000
; entries 32229  guest ops 48  retired 1546992  0.56% of window
; TRUNCATED at --max-ops: no terminator within the window

0041a000  0b ca                        or ecx, edx
0041a002  8b d3                        mov edx, ebx
0041a004  33 d6                        xor edx, esi
0041a006  33 d1                        xor edx, ecx
0041a008  03 d5                        add edx, ebp
0041a00a  8b 6c 24 30                  mov ebp, [esp+0x30]
0041a00e  8d 84 10 a1 eb d9 6e         lea eax, [eax+edx+0x6ed9eba1]
0041a015  8b d0                        mov edx, eax
0041a017  c1 ea 1d                     shr edx, 0x1d
0041a01a  c1 e0 03                     shl eax, 0x3
0041a01d  0b d0                        or edx, eax
0041a01f  8b c6                        mov eax, esi
0041a021  33 c1                        xor eax, ecx
0041a023  33 c2                        xor eax, edx
0041a025  03 c5                        add eax, ebp
0041a027  8b 6c 24 20                  mov ebp, [esp+0x20]
0041a02b  8d 84 03 a1 eb d9 6e         lea eax, [ebx+eax+0x6ed9eba1]
0041a032  8b d8                        mov ebx, eax
0041a034  c1 eb 17                     shr ebx, 0x17
0041a037  c1 e0 09                     shl eax, 0x9
0041a03a  0b d8                        or ebx, eax
0041a03c  8b c3                        mov eax, ebx
0041a03e  33 c1                        xor eax, ecx
0041a040  33 c2                        xor eax, edx
0041a042  03 c5                        add eax, ebp
0041a044  8b eb                        mov ebp, ebx
0041a046  8d 84 06 a1 eb d9 6e         lea eax, [esi+eax+0x6ed9eba1]
0041a04d  8b f0                        mov esi, eax
0041a04f  c1 ee 15                     shr esi, 0x15
0041a052  c1 e0 0b                     shl eax, 0xb
0041a055  0b f0                        or esi, eax
0041a057  33 ee                        xor ebp, esi
0041a059  8b c5                        mov eax, ebp
0041a05b  33 c2                        xor eax, edx
0041a05d  03 44 24 40                  add eax, [esp+0x40]
0041a061  8d 8c 01 a1 eb d9 6e         lea ecx, [ecx+eax+0x6ed9eba1]
0041a068  8b c1                        mov eax, ecx
0041a06a  c1 e8 11                     shr eax, 0x11
0041a06d  c1 e1 0f                     shl ecx, 0xf
0041a070  0b c1                        or eax, ecx
0041a072  33 e8                        xor ebp, eax
0041a074  03 6c 24 18                  add ebp, [esp+0x18]
0041a078  8d 94 2a a1 eb d9 6e         lea edx, [edx+ebp+0x6ed9eba1]
0041a07f  8b 6c 24 38                  mov ebp, [esp+0x38]
0041a083  8b ca                        mov ecx, edx
0041a085  c1 e9 1d                     shr ecx, 0x1d
0041a088  c1 e2 03                     shl edx, 0x3
0041a08b  0b ca                        or ecx, edx

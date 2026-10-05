; diablo-loading-11-0x007cd8a8
; runtime 0x007cd8a8  module storm.dll  orig 0x1502c8a8
; entries 616302  guest ops 21  retired 12942342  2.19% of window

1502c8a8  8b 07                        mov eax, [edi]
1502c8aa  33 d2                        xor edx, edx
1502c8ac  8a 94 06 34 22 00 00         mov dl, [esi+eax+0x2234]
1502c8b3  40                           inc eax
1502c8b4  8b cb                        mov ecx, ebx
1502c8b6  c1 e2 08                     shl edx, 0x8
1502c8b9  89 07                        mov [edi], eax
1502c8bb  0b 56 14                     or edx, [esi+0x14]
1502c8be  8b 46 18                     mov eax, [esi+0x18]
1502c8c1  2a c8                        sub cl, al
1502c8c3  89 56 14                     mov [esi+0x14], edx
1502c8c6  2b c3                        sub eax, ebx
1502c8c8  5f                           pop edi
1502c8c9  d3 ea                        shr edx, cl
1502c8cb  83 c0 08                     add dword eax, 0x8
1502c8ce  89 56 14                     mov [esi+0x14], edx
1502c8d1  89 46 18                     mov [esi+0x18], eax
1502c8d4  33 c0                        xor eax, eax
1502c8d6  5e                           pop esi
1502c8d7  5b                           pop ebx
1502c8d8  c3                           ret

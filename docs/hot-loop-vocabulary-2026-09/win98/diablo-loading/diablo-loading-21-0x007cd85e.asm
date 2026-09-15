; diablo-loading-21-0x007cd85e
; runtime 0x007cd85e  module storm.dll  orig 0x1502c85e
; entries 665095  guest ops 9  retired 5985855  1.01% of window

1502c85e  8a cb                        mov cl, bl
1502c860  2b c3                        sub eax, ebx
1502c862  5f                           pop edi
1502c863  89 46 18                     mov [esi+0x18], eax
1502c866  d3 6e 14                     shr [esi+0x14], cl
1502c869  33 c0                        xor eax, eax
1502c86b  5e                           pop esi
1502c86c  5b                           pop ebx
1502c86d  c3                           ret

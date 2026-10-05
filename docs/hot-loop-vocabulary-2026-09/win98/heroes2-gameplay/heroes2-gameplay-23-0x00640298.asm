; heroes2-gameplay-23-0x00640298
; runtime 0x00640298  module MSS32.DLL  orig 0x20001298
; entries 232640  guest ops 6  retired 1395840  0.97% of window

20001298  a1 a0 06 02 20               mov eax, [0x200206a0]
2000129d  8b 0d 3c d0 01 20            mov ecx, [0x2001d03c]
200012a3  c1 e0 05                     shl eax, 0x5
200012a6  03 c1                        add eax, ecx
200012a8  83 38 02                     cmp dword [eax], 0x2
200012ab  75 69                        jnz short 0x20001316

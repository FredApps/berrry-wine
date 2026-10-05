; heroes2-gameplay-24-0x00640316
; runtime 0x00640316  module MSS32.DLL  orig 0x20001316
; entries 232640  guest ops 6  retired 1395840  0.97% of window

20001316  a1 a0 06 02 20               mov eax, [0x200206a0]
2000131b  8b 0d 98 06 02 20            mov ecx, [0x20020698]
20001321  40                           inc eax
20001322  a3 a0 06 02 20               mov [0x200206a0], eax
20001327  3b c1                        cmp eax, ecx
20001329  0f 8c 69 ff ff ff            jl 0x20001298

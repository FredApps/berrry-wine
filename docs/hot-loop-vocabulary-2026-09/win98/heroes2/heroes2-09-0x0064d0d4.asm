; heroes2-09-0x0064d0d4
; runtime 0x0064d0d4  module MSS32.DLL  orig 0x2000e0d4
; entries 211264  guest ops 8  retired 1690112  2.51% of window

2000e0d4  a1 10 09 02 20               mov eax, [0x20020910]
2000e0d9  8b 0d 00 09 02 20            mov ecx, [0x20020900]
2000e0df  48                           dec eax
2000e0e0  81 c1 2c 07 00 00            add dword ecx, 0x72c
2000e0e6  a3 10 09 02 20               mov [0x20020910], eax
2000e0eb  89 0d 00 09 02 20            mov [0x20020900], ecx
2000e0f1  85 c0                        test eax, eax
2000e0f3  0f 85 f5 f8 ff ff            jnz 0x2000d9ee

; quake2-gameplay-25-0x00d90fbb
; runtime 0x00d90fbb  module ref_soft.dll  orig 0x10012fbb
; entries 2807826  guest ops 8  retired 22462608  0.75% of window

10012fbb  89 37                        mov [edi], esi
10012fbd  8b 46 04                     mov eax, [esi+0x4]
10012fc0  89 47 04                     mov [edi+0x4], eax
10012fc3  89 7e 04                     mov [esi+0x4], edi
10012fc6  89 38                        mov [eax], edi
10012fc8  8b 5b 0c                     mov ebx, [ebx+0xc]
10012fcb  81 fb 40 85 11 10            cmp dword ebx, 0x10118540
10012fd1  0f 85 72 fe ff ff            jnz 0x10012e49

; rct-loading-18-0x008fb9ce
; runtime 0x008fb9ce  module RCT.exe  orig 0x008fb9ce
; entries 3192135  guest ops 11  retired 35113485  1.00% of window

008fb9ce  66 8b 0b                     mov cx, [ebx]
008fb9d1  33 d2                        xor edx, edx
008fb9d3  88 0d 32 10 8f 00            mov [0x8f1032], cl
008fb9d9  83 c3 02                     add dword ebx, 0x2
008fb9dc  80 e1 7f                     and byte cl, 0x7f
008fb9df  8b f3                        mov esi, ebx
008fb9e1  86 d5                        xchg ch, dl
008fb9e3  03 d9                        add ebx, ecx
008fb9e5  8b fd                        mov edi, ebp
008fb9e7  2b 15 24 90 8e 00            sub edx, [0x8e9024]
008fb9ed  7e 04                        jle short 0x8fb9f3

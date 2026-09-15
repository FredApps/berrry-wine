; rct-loading-01-0x008fb941
; runtime 0x008fb941  module RCT.exe  orig 0x008fb941
; entries 11059211  guest ops 11  retired 121651321  3.46% of window

008fb941  66 8b 0b                     mov cx, [ebx]
008fb944  33 d2                        xor edx, edx
008fb946  88 0d 32 10 8f 00            mov [0x8f1032], cl
008fb94c  83 c3 02                     add dword ebx, 0x2
008fb94f  80 e1 7f                     and byte cl, 0x7f
008fb952  8b f3                        mov esi, ebx
008fb954  86 d5                        xchg ch, dl
008fb956  03 d9                        add ebx, ecx
008fb958  8b fd                        mov edi, ebp
008fb95a  2b 15 24 90 8e 00            sub edx, [0x8e9024]
008fb960  7e 04                        jle short 0x8fb966

; quake2-gameplay-24-0x00d90e74
; runtime 0x00d90e74  module ref_soft.dll  orig 0x10012e74
; entries 2808812  guest ops 8  retired 22470496  0.76% of window

10012e74  c1 ef 0a                     shr edi, 0xa
10012e77  a1 2c 85 11 10               mov eax, [0x1011852c]
10012e7c  03 f8                        add edi, eax
10012e7e  8b 35 78 56 34 12            mov esi, [0x12345678]
10012e84  8b 57 14                     mov edx, [edi+0x14]
10012e87  8b 47 28                     mov eax, [edi+0x28]
10012e8a  85 c0                        test eax, eax
10012e8c  75 2a                        jnz short 0x10012eb8

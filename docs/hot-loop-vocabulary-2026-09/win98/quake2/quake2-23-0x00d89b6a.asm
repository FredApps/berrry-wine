; quake2-23-0x00d89b6a
; runtime 0x00d89b6a  module ref_soft.dll  orig 0x1000bb6a
; entries 71940  guest ops 30  retired 2158200  0.59% of window

1000bb6a  33 d2                        xor edx, edx
1000bb6c  8a 10                        mov dl, [eax]
1000bb6e  c1 e2 08                     shl edx, 0x8
1000bb71  03 d1                        add edx, ecx
1000bb73  8b 0d 88 82 0e 10            mov ecx, [0x100e8288]
1000bb79  8a 14 0a                     mov dl, [edx+ecx]
1000bb7c  88 10                        mov [eax], dl
1000bb7e  a1 c4 58 03 10               mov eax, [0x100358c4]
1000bb83  8b 0d e0 58 03 10            mov ecx, [0x100358e0]
1000bb89  8b 35 dc 58 03 10            mov esi, [0x100358dc]
1000bb8f  8b 15 d4 58 03 10            mov edx, [0x100358d4]
1000bb95  03 f1                        add esi, ecx
1000bb97  8b 0d c8 58 03 10            mov ecx, [0x100358c8]
1000bb9d  89 35 dc 58 03 10            mov [0x100358dc], esi
1000bba3  8b 35 cc 58 03 10            mov esi, [0x100358cc]
1000bba9  83 c1 02                     add dword ecx, 0x2
1000bbac  89 0d c8 58 03 10            mov [0x100358c8], ecx
1000bbb2  8b 0d d8 58 03 10            mov ecx, [0x100358d8]
1000bbb8  03 f2                        add esi, edx
1000bbba  8b 15 d0 58 03 10            mov edx, [0x100358d0]
1000bbc0  03 d1                        add edx, ecx
1000bbc2  8b 0d e8 58 03 10            mov ecx, [0x100358e8]
1000bbc8  40                           inc eax
1000bbc9  49                           dec ecx
1000bbca  85 c9                        test ecx, ecx
1000bbcc  a3 c4 58 03 10               mov [0x100358c4], eax
1000bbd1  89 35 cc 58 03 10            mov [0x100358cc], esi
1000bbd7  89 15 d0 58 03 10            mov [0x100358d0], edx
1000bbdd  89 0d e8 58 03 10            mov [0x100358e8], ecx
1000bbe3  0f 8f 3d ff ff ff            jg 0x1000bb26

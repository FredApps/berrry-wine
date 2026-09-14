; diablo-21-0x007bdb66
; runtime 0x007bdb66  module storm.dll  orig 0x1501cb66
; entries 2062152  guest ops 7  retired 14435064  0.98% of window

1501cb66  8a 0f                        mov cl, [edi]
1501cb68  8a 57 01                     mov dl, [edi+0x1]
1501cb6b  47                           inc edi
1501cb6c  88 54 24 13                  mov [esp+0x13], dl
1501cb70  47                           inc edi
1501cb71  84 c9                        test cl, cl
1501cb73  75 08                        jnz short 0x1501cb7d

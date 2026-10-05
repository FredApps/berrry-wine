; starcraft-21-0x008e8632
; runtime 0x008e8632  module smackw32.dll  orig 0x10012632
; entries 760879  guest ops 6  retired 4565274  1.41% of window

10012632  02 c8                        add cl, al
10012634  80 d5 00                     adc byte ch, 0x0
10012637  8b 15 80 4a 01 10            mov edx, [0x10014a80]
1001263d  8b 02                        mov eax, [edx]
1001263f  a9 00 00 00 80               test eax, 0x80000000
10012644  75 29                        jnz short 0x1001266f

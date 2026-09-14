; starcraft-23-0x008e86ac
; runtime 0x008e86ac  module smackw32.dll  orig 0x100126ac
; entries 760879  guest ops 6  retired 4565274  1.41% of window

100126ac  02 c8                        add cl, al
100126ae  80 d5 00                     adc byte ch, 0x0
100126b1  8b 15 88 4a 01 10            mov edx, [0x10014a88]
100126b7  8b 02                        mov eax, [edx]
100126b9  a9 00 00 00 80               test eax, 0x80000000
100126be  75 29                        jnz short 0x100126e9

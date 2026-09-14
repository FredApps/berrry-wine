; starcraft-22-0x008e866f
; runtime 0x008e866f  module smackw32.dll  orig 0x1001266f
; entries 760879  guest ops 6  retired 4565274  1.41% of window

1001266f  02 e8                        add ch, al
10012671  c1 c9 10                     ror ecx, 0x10
10012674  8b 15 84 4a 01 10            mov edx, [0x10014a84]
1001267a  8b 02                        mov eax, [edx]
1001267c  a9 00 00 00 80               test eax, 0x80000000
10012681  75 29                        jnz short 0x100126ac

; starcraft-24-0x008e86e9
; runtime 0x008e86e9  module smackw32.dll  orig 0x100126e9
; entries 760879  guest ops 6  retired 4565274  1.41% of window

100126e9  02 e8                        add ch, al
100126eb  c1 c9 10                     ror ecx, 0x10
100126ee  89 0f                        mov [edi], ecx
100126f0  83 c7 04                     add dword edi, 0x4
100126f3  39 3d fc 4b 01 10            cmp [0x10014bfc], edi
100126f9  74 17                        jz short 0x10012712

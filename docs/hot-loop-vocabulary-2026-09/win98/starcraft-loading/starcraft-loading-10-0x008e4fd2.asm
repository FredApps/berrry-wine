; starcraft-loading-10-0x008e4fd2
; runtime 0x008e4fd2  module smackw32.dll  orig 0x1000efd2
; entries 8154816  guest ops 7  retired 57083712  2.61% of window

1000efd2  8b 0d 24 4a 01 10            mov ecx, [0x10014a24]
1000efd8  c1 ca 10                     ror edx, 0x10
1000efdb  a2 c0 4a 01 10               mov [0x10014ac0], al
1000efe0  66 8b c2                     mov ax, dx
1000efe3  c1 ca 10                     ror edx, 0x10
1000efe6  39 11                        cmp [ecx], edx
1000efe8  74 16                        jz short 0x1000f000

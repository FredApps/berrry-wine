; starcraft-loading-22-0x008e4df2
; runtime 0x008e4df2  module smackw32.dll  orig 0x1000edf2
; entries 3550273  guest ops 7  retired 24851911  1.14% of window

1000edf2  8b 0d 34 4a 01 10            mov ecx, [0x10014a34]
1000edf8  c1 ca 10                     ror edx, 0x10
1000edfb  a2 c0 4a 01 10               mov [0x10014ac0], al
1000ee00  66 8b c2                     mov ax, dx
1000ee03  c1 ca 10                     ror edx, 0x10
1000ee06  39 11                        cmp [ecx], edx
1000ee08  74 16                        jz short 0x1000ee20

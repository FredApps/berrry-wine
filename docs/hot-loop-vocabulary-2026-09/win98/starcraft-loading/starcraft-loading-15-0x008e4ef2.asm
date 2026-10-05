; starcraft-loading-15-0x008e4ef2
; runtime 0x008e4ef2  module smackw32.dll  orig 0x1000eef2
; entries 8154816  guest ops 5  retired 40774080  1.86% of window

1000eef2  8b 0d 24 4a 01 10            mov ecx, [0x10014a24]
1000eef8  a2 c0 4a 01 10               mov [0x10014ac0], al
1000eefd  8b c2                        mov eax, edx
1000eeff  39 11                        cmp [ecx], edx
1000ef01  74 16                        jz short 0x1000ef19

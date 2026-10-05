; starcraft-loading-03-0x008e4f03
; runtime 0x008e4f03  module smackw32.dll  orig 0x1000ef03
; entries 7920893  guest ops 11  retired 87129823  3.98% of window

1000ef03  8b 29                        mov ebp, [ecx]
1000ef05  8b 1d 28 4a 01 10            mov ebx, [0x10014a28]
1000ef0b  89 11                        mov [ecx], edx
1000ef0d  8b 0d 2c 4a 01 10            mov ecx, [0x10014a2c]
1000ef13  8b 13                        mov edx, [ebx]
1000ef15  89 2b                        mov [ebx], ebp
1000ef17  89 11                        mov [ecx], edx
1000ef19  a0 c0 4a 01 10               mov al, [0x10014ac0]
1000ef1e  8b 1d d0 4a 01 10            mov ebx, [0x10014ad0]
1000ef24  3c 20                        cmp al, 0x20
1000ef26  77 58                        ja short 0x1000ef80

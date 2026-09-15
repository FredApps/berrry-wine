; diablo-loading-22-0x007cd598
; runtime 0x007cd598  module storm.dll  orig 0x1502c598
; entries 996816  guest ops 6  retired 5980896  1.01% of window

1502c598  8a 01                        mov al, [ecx]
1502c59a  41                           inc ecx
1502c59b  88 02                        mov [edx], al
1502c59d  42                           inc edx
1502c59e  ff 4c 24 10                  dec [esp+0x10]
1502c5a2  75 f4                        jnz short 0x1502c598

; diablo-10-0x007be154
; runtime 0x007be154  module storm.dll  orig 0x1501d154
; entries 7136486  guest ops 5  retired 35682430  2.42% of window

1501d154  8b 44 24 20                  mov eax, [esp+0x20]
1501d158  85 c0                        test eax, eax
1501d15a  8d 50 ff                     lea edx, [eax-0x1]
1501d15d  89 54 24 20                  mov [esp+0x20], edx
1501d161  0f 85 4e ff ff ff            jnz 0x1501d0b5

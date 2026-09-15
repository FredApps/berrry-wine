; diablo-loading-13-0x007bdfec
; runtime 0x007bdfec  module storm.dll  orig 0x1501cfec
; entries 2255306  guest ops 5  retired 11276530  1.91% of window

1501cfec  c7 44 24 24 01 00 00 00      mov dword [esp+0x24], 0x1
1501cff4  43                           inc ebx
1501cff5  40                           inc eax
1501cff6  3b 44 24 1c                  cmp eax, [esp+0x1c]
1501cffa  7c c4                        jl short 0x1501cfc0

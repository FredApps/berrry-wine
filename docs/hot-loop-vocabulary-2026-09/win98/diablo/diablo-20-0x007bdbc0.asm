; diablo-20-0x007bdbc0
; runtime 0x007bdbc0  module storm.dll  orig 0x1501cbc0
; entries 3120937  guest ops 6  retired 18725622  1.27% of window

1501cbc0  8a 10                        mov dl, [eax]
1501cbc2  40                           inc eax
1501cbc3  88 16                        mov [esi], dl
1501cbc5  46                           inc esi
1501cbc6  fe c9                        dec byte cl
1501cbc8  75 f6                        jnz short 0x1501cbc0

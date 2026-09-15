; diablo-loading-18-0x007bdbad
; runtime 0x007bdbad  module storm.dll  orig 0x1501cbad
; entries 1285841  guest ops 6  retired 7715046  1.31% of window

1501cbad  8b 18                        mov ebx, [eax]
1501cbaf  83 c6 04                     add dword esi, 0x4
1501cbb2  83 c0 04                     add dword eax, 0x4
1501cbb5  fe ca                        dec byte dl
1501cbb7  89 5e fc                     mov [esi-0x4], ebx
1501cbba  75 f1                        jnz short 0x1501cbad

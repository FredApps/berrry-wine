; heroes2-02-0x0064ca61
; runtime 0x0064ca61  module MSS32.DLL  orig 0x2000da61
; entries 844907  guest ops 6  retired 5069442  7.53% of window

2000da61  a1 08 09 02 20               mov eax, [0x20020908]
2000da66  8b 0d 00 09 02 20            mov ecx, [0x20020900]
2000da6c  8b 94 81 6c 05 00 00         mov edx, [ecx+eax*4+0x56c]
2000da73  8d 04 81                     lea eax, [ecx+eax*4]
2000da76  3b d6                        cmp edx, esi
2000da78  74 6e                        jz short 0x2000dae8

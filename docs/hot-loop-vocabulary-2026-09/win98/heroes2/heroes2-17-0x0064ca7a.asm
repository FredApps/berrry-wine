; heroes2-17-0x0064ca7a
; runtime 0x0064ca7a  module MSS32.DLL  orig 0x2000da7a
; entries 136239  guest ops 7  retired 953673  1.42% of window

2000da7a  ff 88 6c 06 00 00            dec [eax+0x66c]
2000da80  a1 08 09 02 20               mov eax, [0x20020908]
2000da85  8b 15 00 09 02 20            mov edx, [0x20020900]
2000da8b  8b 8c 82 6c 06 00 00         mov ecx, [edx+eax*4+0x66c]
2000da92  8d 04 82                     lea eax, [edx+eax*4]
2000da95  85 c9                        test ecx, ecx
2000da97  7f 4f                        jg short 0x2000dae8

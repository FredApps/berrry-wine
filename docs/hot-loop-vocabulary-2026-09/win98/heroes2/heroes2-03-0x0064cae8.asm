; heroes2-03-0x0064cae8
; runtime 0x0064cae8  module MSS32.DLL  orig 0x2000dae8
; entries 844906  guest ops 5  retired 4224530  6.28% of window

2000dae8  a1 08 09 02 20               mov eax, [0x20020908]
2000daed  40                           inc eax
2000daee  a3 08 09 02 20               mov [0x20020908], eax
2000daf3  3b c3                        cmp eax, ebx
2000daf5  0f 8c 66 ff ff ff            jl 0x2000da61

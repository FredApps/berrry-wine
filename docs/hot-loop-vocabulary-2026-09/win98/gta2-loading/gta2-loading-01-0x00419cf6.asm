; gta2-loading-01-0x00419cf6
; runtime 0x00419cf6  module gta2.exe  orig 0x00419cf6
; entries 197648  guest ops 17  retired 3360016  58.29% of window

00419cf6  8b 4c 24 24                  mov ecx, [esp+0x24]
00419cfa  33 c0                        xor eax, eax
00419cfc  8a 85 98 00 00 00            mov al, [ebp+0x98]
00419d02  81 e1 ff 00 00 00            and dword ecx, 0xff
00419d08  c1 e0 04                     shl eax, 0x4
00419d0b  03 c1                        add eax, ecx
00419d0d  fe c2                        inc byte dl
00419d0f  88 54 24 24                  mov [esp+0x24], dl
00419d13  8d 34 40                     lea esi, [eax+eax*2]
00419d16  8d 04 b0                     lea eax, [eax+esi*4]
00419d19  c6 84 c5 c8 00 00 00 00      mov byte [ebp+eax*8+0xc8], 0x0
00419d21  8d 04 49                     lea eax, [ecx+ecx*2]
00419d24  8d 0c 81                     lea ecx, [ecx+eax*4]
00419d27  c6 84 cd ec 0d 00 00 00      mov byte [ebp+ecx*8+0xdec], 0x0
00419d2f  8a 45 10                     mov al, [ebp+0x10]
00419d32  3a d0                        cmp dl, al
00419d34  72 c0                        jb short 0x419cf6

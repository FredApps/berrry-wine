; gta2-gameplay-01-0x004d7660
; runtime 0x004d7660  module gta2.exe  orig 0x004d7660
; entries 312977  guest ops 5  retired 1564885  2.53% of window

004d7660  8b 81 2c 03 00 00            mov eax, [ecx+0x32c]
004d7666  8b 4c 24 04                  mov ecx, [esp+0x4]
004d766a  81 e1 ff ff 00 00            and dword ecx, 0xffff
004d7670  8b 44 88 04                  mov eax, [eax+ecx*4+0x4]
004d7674  c2 04 00                     ret 0x4

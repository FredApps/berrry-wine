; gta2-gameplay-17-0x004d724a
; runtime 0x004d724a  module gta2.exe  orig 0x004d724a
; entries 119125  guest ops 5  retired 595625  0.96% of window

004d724a  66 ff 86 64 03 00 00         inc [esi+0x364]
004d7251  8b 8e 2c 03 00 00            mov ecx, [esi+0x32c]
004d7257  66 8b 86 64 03 00 00         mov ax, [esi+0x364]
004d725e  66 3b 01                     cmp ax, [ecx]
004d7261  0f 82 6f ff ff ff            jb 0x4d71d6

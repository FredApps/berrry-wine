; gta2-gameplay-20-0x004d7050
; runtime 0x004d7050  module gta2.exe  orig 0x004d7050
; entries 107554  guest ops 5  retired 537770  0.87% of window

004d7050  66 ff 86 64 03 00 00         inc [esi+0x364]
004d7057  8b 8e 2c 03 00 00            mov ecx, [esi+0x32c]
004d705d  66 8b 86 64 03 00 00         mov ax, [esi+0x364]
004d7064  66 3b 01                     cmp ax, [ecx]
004d7067  0f 82 63 ff ff ff            jb 0x4d6fd0

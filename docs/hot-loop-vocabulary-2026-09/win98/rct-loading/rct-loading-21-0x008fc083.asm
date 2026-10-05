; rct-loading-21-0x008fc083
; runtime 0x008fc083  module RCT.exe  orig 0x008fc083
; entries 1519949  guest ops 18  retired 27359082  0.78% of window

008fc083  8a 46 04                     mov al, [esi+0x4]
008fc086  8a 04 18                     mov al, [eax+ebx]
008fc089  88 47 04                     mov [edi+0x4], al
008fc08c  8a 46 03                     mov al, [esi+0x3]
008fc08f  8a 04 18                     mov al, [eax+ebx]
008fc092  88 47 03                     mov [edi+0x3], al
008fc095  8a 46 02                     mov al, [esi+0x2]
008fc098  8a 04 18                     mov al, [eax+ebx]
008fc09b  88 47 02                     mov [edi+0x2], al
008fc09e  8a 46 01                     mov al, [esi+0x1]
008fc0a1  8a 04 18                     mov al, [eax+ebx]
008fc0a4  88 47 01                     mov [edi+0x1], al
008fc0a7  8a 06                        mov al, [esi]
008fc0a9  8a 04 18                     mov al, [eax+ebx]
008fc0ac  88 07                        mov [edi], al
008fc0ae  87 1d 0c 90 8e 00            xchg [0x8e900c], ebx
008fc0b4  f6 05 32 10 8f 00 80         test [0x8f1032], 0x80
008fc0bb  0f 84 0d f9 ff ff            jz 0x8fb9ce

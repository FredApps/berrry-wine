; mw3-03-0x0046acb0
; runtime 0x0046acb0  module mech3demo.exe  orig 0x0046acb0
; entries 26636  guest ops 12  retired 319632  2.99% of window

0046acb0  6a ff                        push 0xff
0046acb2  68 0b ed 57 00               push 0x57ed0b
0046acb7  64 a1 00 00 00 00            fs: mov eax, [0x0]
0046acbd  50                           push eax
0046acbe  64 89 25 00 00 00 00         fs: mov [0x0], esp
0046acc5  51                           push ecx
0046acc6  56                           push esi
0046acc7  8b f1                        mov esi, ecx
0046acc9  57                           push edi
0046acca  8b 4e 08                     mov ecx, [esi+0x8]
0046accd  85 c9                        test ecx, ecx
0046accf  74 48                        jz short 0x46ad19

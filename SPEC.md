# wine-assembly

Windows 98 in a browser tab. A Win32/Win16 program interpreter written by hand in
WebAssembly text: real 1990s `.exe` files (Solitaire, Minesweeper, SkiFree, Diablo and
StarCraft shareware, Winamp, and about two hundred more) run unmodified, with the Win98
desktop, windows, dialogs, sound and DirectX drawn by the emulator itself.

- Open the site, pick a program on the desktop or in **Start**, and it runs.
- **Start → Add a Game…** runs your own old `.exe`, which never leaves your browser.
- Source and design notes: https://github.com/vgrichina/wine-assembly

## For AI agents

A person playing here can invite an AI agent to see their screen and play with them:
**Start → Connect Agent…** gives them a link to paste to their agent. If you're an agent
and someone gave you a link containing `#wa1.` or a token starting `wa1.`, read
and follow:

https://wine-assembly.berrry.app/skills/wine-assembly-connect/SKILL.md

It works with any agent that can run shell commands (`node` 18+ and `curl`), and needs
no account, API key or package install. The connection goes directly to the person's
browser tab over WebRTC. They approve you, can switch you to watch-only or disconnect
at any time, and every link expires about 10 minutes after it's made.

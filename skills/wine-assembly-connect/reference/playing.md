# Playing Windows 98 programs through wine-agent

## The loop

1. `GET /screenshot.png` and look at it.
2. Decide one action.
3. Do it.
4. Screenshot again: confirm it did what you expected before going on.

Don't chain several blind clicks. A dialog you didn't expect, a menu that opened
somewhere else, or an animation that shifted things will make every later click land
wrong.

## Real time vs frozen

The game runs in real time while you think. That's fine for card games, puzzles and
anything turn-based: Solitaire, FreeCell, Minesweeper, Reversi, and strategy games
when they're paused.

For action games, use frozen mode:

    POST /frozen {"on":true}
    POST /key {"key":"Right","type":"down"}
    POST /step {"n":5}
    GET  /screenshot.png
    …
    POST /key {"key":"Right","type":"up"}

Each `/step` advances the game a fixed amount and then stops it, so the picture you
analyse is still the picture when you act. Start with small `n` (1 to 10) and increase
it once you know how far one step moves things. Turn frozen mode off before handing
back to the person.

## Windows 98 conventions

- **Menus.** Click the menu name, then screenshot: the menu drops down. `Alt` plus the
  underlined letter also works (`/key Alt`, then the letter), and `Escape` closes a
  menu.
- **Dialogs.** `Enter` presses the default button (the one with the thick border) and
  `Escape` presses Cancel. `Tab` moves between controls.
- **Double-click** opens desktop icons and files.
- **Right-click** exists in some games (Minesweeper flags, strategy-game orders).
- **Title bar buttons** are at the top right of each window: `_`, `□`, `x`.
- **New game** is often `F2` (the Entertainment Pack games, Solitaire, Minesweeper).

## Clicks that don't register

Some controls act on the button *release*, and a few ignore a press and release that
arrive together. Use `/mouse` with `type:"down"`, then `/mouse` with `type:"up"` in a
second request.

## Text

`/type` is right for a name box or a chat line. For game input, use `/key` with
explicit down and up, because games read held keys and not characters.

## Being a good guest

- The person is watching. Say what you're about to do, especially before anything
  destructive (new game, quit, overwriting a save).
- If an action is refused with "watch-only" or "paused", the person took over. Stop
  and ask; don't retry.
- If `lastEvent` is `user-took-input`, the person just grabbed the controls. Wait
  for them.
- Disconnect when you're done (`POST /disconnect`), so their Start menu stops showing
  a connected agent.

# D: same-block forward-store diagnostic. Design (source only, not implemented)

This is a diagnostic investigation only. It changes no behaviour, closes no task and does not
resolve the CPU contract (SMC-SAME-BLOCK-ALTERNATIVES.md §4).

## What the host can see today (dos-loop.js step(), base 2683a6e3)

At a kind-2 SMC break (dos-loop.js ~1844-1890) the host has:

- `smclo`/`smchi`: the linear range written;
- `cs:gip`: where the slice STOPPED, i.e. the transfer target after the storing block;
- `cs:ip`: the slice's entry block.

It does **not** have:

- the storing instruction's address, because store handlers carry no ip operand;
- the start of the block that executed last. `$gip` is published at transfers, and a slice can run
  many blocks.

So the bucket "distance from the store to its target" **cannot be computed host-side today**. The
proposal in 03b53c34 assumed it could. Corrected here.

## Layered options

| layer | what it measures | how | cost | limits |
|---|---|---|---|---|
| D1 static census | blocks whose decode contains a store with a STATIC target inside the same block, after the store | in decode.js, for disp-only stores (16-bit mod=00 rm=110, 32-bit mod=00 rm=101): target = segment base at decode + disp. Count when the target lies in (storeEnd, blockEnd), bucketed by target − storeEnd: < 16, 16–31, ≥ 32 | decode time only; zero on the fast path | misses register-indirect stores. The segment base read at decode time may differ when the store runs, so a hit is a candidate, not proof |
| D2 runtime overlap | kind-2 breaks whose written range overlaps the code of a block that contains the last transfer before the break | at the break, look up cached blocks covering `smclo` and check whether one of them is a block whose exit transfers to `cs:gip` (the cache's edge/jump tables) | slow path only (breaks) | ambiguous when several blocks reach `gip`; no store address, so no distance; it shows "this break dirtied code that may have just run stale", not by how much |
| D3 exact | the same as D1 for all stores, with the exact distance | a new VM global recording the storing instruction's ip whenever `$wr*` sets `$smc` (store handlers would need their ip, or `$gip` would need to be per instruction) | changes store handlers, and possibly the fast path; must be measured, and violates "diagnostic with no fast-path cost" | invasive; not recommended for a diagnostic |

## Recommendation

D1 + D2 together, reported side by side and never merged into one number:

- **D1** names candidate sites with exact static distances.
- **D2** says whether those sites, or others, actually broke at runtime and dirtied code that had
  just run.
- **A D1 site that also appears in D2** is a concrete test case for any contract.

**Neither layer can show the absence of stale execution, or arm parity.** A zero count is a
statement about one finite corpus, observed through two imperfect lenses.

## Not done

No code is written yet; the diff would be prepared next, source-only. Nothing has run. Any sweep
needs a root grant after the Ultima slot and the report-all fixture.

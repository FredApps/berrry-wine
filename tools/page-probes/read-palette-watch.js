// Read back what tools/page-probes/arm-palette-watch.js collected.
//
// Returns the bursts as JSON, newest last, with a one-line verdict per burst so
// a resume that damaged the picture is visible without reading every sample.
// The verdict compares the LAST sample of the previous burst (the baseline)
// against the FIRST sample of this one (the instant of the transition) and
// against its last (whether it healed).
JSON.stringify((function () {
  var s = window.__palWatch;
  if (!s) return { error: 'not armed -- run arm-palette-watch.js first' };

  function colOf(x) { return x && x.screen && typeof x.screen.col === 'number' ? x.screen.col : null; }
  function palMean(x) {
    if (!x || !x.pal || !x.pal.length) return null;
    var n = 0, sum = 0;
    x.pal.forEach(function (p) { sum += p.meanRGB; n++; });
    return n ? +(sum / n).toFixed(1) : null;
  }

  var prevLast = null;
  var bursts = s.bursts.map(function (b) {
    var first = b.samples[0] || null;
    var last = b.samples[b.samples.length - 1] || null;
    var verdict = 'no samples';
    if (first && last) {
      var c0 = colOf(first), c1 = colOf(last), base = colOf(prevLast);
      var p0 = palMean(first);
      if (c0 === null) {
        verdict = 'no canvas readback';
      } else if (base !== null && c0 < base * 0.5) {
        // Colour collapsed across the transition. Which half is at fault is
        // exactly what the palette column answers.
        verdict = (p0 !== null && p0 > 8)
          ? 'SCREEN LOST COLOUR, PALETTE INTACT -- stale composite or dropped backing store'
          : 'SCREEN AND PALETTE BOTH DARK -- guest is mid-fade, likely correct';
        verdict += (c1 !== null && base !== null && c1 > base * 0.8)
          ? ' (healed within 4s)' : ' (STILL WRONG at 4s)';
      } else {
        verdict = 'no colour collapse';
      }
    }
    prevLast = last || prevLast;
    return {
      label: b.label, startedAt: b.startedAt, verdict: verdict,
      samples: b.samples,
    };
  });

  return { armed: !!s.armed, nBursts: bursts.length, bursts: bursts };
})());

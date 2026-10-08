// Page probe (--report-eval): read back tools/page-probes/arm-launch-bytes.js.
// Returns JSON: bytes fetched before the first guest frame and by now, the
// share of them that were HTTP range reads, and the ten URLs that cost most.
(function () {
  const s = window.__launchBytes;
  if (!s) return JSON.stringify({ error: 'arm-launch-bytes.js was not armed before load' });
  const top = Object.entries(s.byUrl).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([url, bytes]) => ({ url: url.replace(/^.*\/test\/binaries\//, ''), bytes }));
  return JSON.stringify({
    firstFrameMs: s.firstFrameAt,
    frames: s.frames,
    atFirstFrame: s.atFirstFrame,
    atEnd: s.snapshot(),
    topUrls: top,
  });
})();

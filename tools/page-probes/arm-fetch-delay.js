// Page probe (--before-load): hold every fetch() for a fixed delay before it
// is sent, the way one network round trip to a remote host would. A local
// dev-server answers in well under a millisecond, which makes request COUNT
// invisible: 100 requests and 10 cost the same there, while over a real link
// each wave of requests pays a round trip. With the delay, "how many requests
// before the first frame" shows up in the time it takes.
//
// The delay is ?fetch-delay=MS on the page URL (default 80). Arm it before
// anything else that wraps fetch, e.g. concatenated ahead of
// arm-launch-bytes.js:
//
//   node tools/profile-web-frames.js --app=ID --query='?debug&fetch-delay=80' \
//     --before-load="$(cat tools/page-probes/arm-fetch-delay.js tools/page-probes/arm-launch-bytes.js)" \
//     --report-eval="$(cat tools/page-probes/read-launch-bytes.js)"
//
// It models latency only, not bandwidth: bytes still arrive at local speed.
(function () {
  if (window.__fetchDelayArmed) return;
  window.__fetchDelayArmed = true;
  const match = /[?&]fetch-delay=(\d+)/.exec(location.search);
  const ms = match ? Number(match[1]) : 80;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => new Promise(resolve => setTimeout(resolve, ms))
    .then(() => real(input, init));
})();

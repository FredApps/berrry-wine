// Is a present-capped app janky, and whose fault is it?
//
// Starts WinePerf's pace log (lib/perf-hud.js recordPacing): a timestamp for
// every paced frame end ($present_pace, dx_trace kind 30, with the wait it
// asked for and the guest ms it decided at), every guest present, and every
// real requestAnimationFrame callback. Also wraps the cooperative
// ThreadManager's main-sleep bookkeeping so each paced Sleep gets its wall
// wake latency: how long after the guest-clock deadline the page actually
// ran the main instance again (the setTimeout(step, 0) chain's granularity).
//
// Pass to tools/profile-web-frames.js as --after-launch, read back with
// read-pace-log.js, summarize with tools/pace-intervals.js.
(function () {
  const perf = window.WinePerf;
  if (!perf || !perf.recordPacing) return 'no WinePerf.recordPacing on this page (load with ?debug&perf)';
  perf.recordPacing(true);
  const log = perf.paceLog;
  log.wakes = [];
  const tm = window.wine && window.wine.threadManager;
  if (tm && typeof tm.checkMainYield === 'function') {
    // checkMainYield is where host.js records a main Sleep (_mainSleepUntil
    // set) and where it ends (cleared once the guest clock passes it). Late =
    // wall time from the deadline, translated to wall when it was set, to
    // the step that cleared it.
    let deadlineWall = null;
    const orig = tm.checkMainYield.bind(tm);
    tm.checkMainYield = function () {
      const before = tm._mainSleepUntil;
      const r = orig();
      const after = tm._mainSleepUntil;
      if (after && after !== before) {
        deadlineWall = performance.now() + Math.max(0, after - tm._waitNow());
      } else if (before && !after && deadlineWall !== null) {
        if (log.wakes.length < 200000) log.wakes.push(performance.now() - deadlineWall);
        deadlineWall = null;
      }
      return r;
    };
    log.wakeHook = 'checkMainYield';
  } else {
    log.wakeHook = 'none (no cooperative threadManager)';
  }
  return `pace log armed (wake hook: ${log.wakeHook})`;
})();

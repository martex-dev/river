// River's core timers (2.13.1), run in a worker. The core's WebView is never shown, and the
// browser slows timers in hidden pages to about one a minute after five minutes ("intensive
// throttling"): linking a device, reconnecting and call timeouts then crawled. Worker timers are
// not throttled that way; this worker only keeps time and says which timer is due.
/* global self */
'use strict';
const timers = new Map();
self.onmessage = (e) => {
  // A dedicated worker hears only the page that started it (its messages carry no origin, or
  // this worker's own); anything else, or anything not shaped like a timer request, is ignored.
  if (e.origin && e.origin !== self.location.origin) return;
  if (!Array.isArray(e.data) || e.data.length > 3) return;
  const [op, id, ms] = e.data;
  if (!Number.isSafeInteger(id) || id <= 0) return;
  if (op !== 'clear' && !(typeof ms === 'number' && ms >= 0 && ms <= 2 ** 31 - 1)) return;
  if (op === 'clear') {
    const t = timers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      clearInterval(t);
      timers.delete(id);
    }
    return;
  }
  if (op === 'once') {
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        self.postMessage(id);
      }, ms),
    );
  } else if (op === 'every') {
    timers.set(
      id,
      setInterval(() => self.postMessage(id), ms),
    );
  }
};
// Ready: the core switches over only once this arrives.
self.postMessage(0);

// Order matters: Node globals first, then timers that keep time while hidden, then the core.
import './prelude.ts';
import './worker-timers.ts';
import './main.ts';

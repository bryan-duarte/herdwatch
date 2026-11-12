// The main.js of a throwaway mod that times one render of Herdwatch in the real engine.
// bench/engine.js replaces __CASE__ and __RANGE__, copies the mod beside this file as herdwatch-main.js, and
// reads the time from the error that render throws: `herdr-app check` renders once and prints that error.
import { View } from "gpui-kit";
import { setShared, shared } from "herdr";
import { HISTORY, RAW } from "./bench-data.js";
import Herdwatch from "./herdwatch-main.js";
import { Poller } from "./poller.js";
import { parseSnapshot } from "./snapshot.js";
import { takePollLease } from "./store.js";

const CASE_NAME = "__CASE__";
const RANGE_SAMPLES = Number("__RANGE__");
const CONSOLE_WIDTH_PX = 640;
const STATE_KEY = "herdwatch.state";
const OLD_HISTORY_KEY = "herdwatch.history";

/** Puts the full history where this version of the mod keeps it: inside the state, or in a key of its own. */
function storeHistory() {
  const state = shared(STATE_KEY);
  if (state && "history" in state) setShared(STATE_KEY, { ...state, history: HISTORY });
  else setShared(OLD_HISTORY_KEY, HISTORY);
}

/** A copy of Herdwatch without its init, so no timer, poll or command loop starts. */
function benchCopy(focusHandle) {
  return Object.assign(Object.create(Herdwatch.prototype), {
    role: CASE_NAME === "pill" ? "bar" : "console",
    width: CONSOLE_WIDTH_PX,
    choices: { host: null, tab: CASE_NAME, range: RANGE_SAMPLES, filter: "all", sort: "cpu" },
    portNotes: {},
    focusHandle,
    drawnClockKey: "",
    checkingPruneOn: null,
    showAllWorktrees: false,
  });
}

export default class Bench extends View {
  init(_props, cx) {
    const parsed = parseSnapshot(RAW);
    if (parsed.ok === false) throw new Error(`QBENCH-SETUP ${parsed.failure.detail}`);
    this.snapshot = parsed.snapshot;
    this.poller = new Poller();
    this.poller.publish(this.snapshot);
    storeHistory();
    this.copy = benchCopy(cx.focus_handle());
    if (CASE_NAME !== "poll") this.copy.render(cx);
  }

  render(cx) {
    const startedAt = performance.now();
    if (CASE_NAME === "poll") {
      takePollLease(this.poller.copyId, Math.floor(Date.now() / 1000));
      this.poller.publish(this.snapshot);
    } else {
      this.copy.render(cx);
    }
    throw new Error(`QBENCH ${JSON.stringify({ ms: performance.now() - startedAt })}`);
  }
}

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
/** The case "frame" draws the console frame on the overview tab. */
const TAB = CASE_NAME === "frame" ? "overview" : CASE_NAME;
const IS_TAB_CASE = !["pill", "frame", "poll"].includes(CASE_NAME);
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
    choices: { host: null, tab: TAB, range: RANGE_SAMPLES, filter: "all", sort: "cpu" },
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
    if (this.copy.role === "console" && this.copy.createTabBody) this.copy.createTabBody(cx);
    // Fills the caches. A retained body can be mounted only in a render, so a mod with one draws its body alone here.
    if (CASE_NAME === "poll") return;
    if (this.copy.role === "console" && this.copy.renderTabBody) this.copy.renderTabBody();
    else this.copy.render(cx);
  }

  /** One redraw: the frame, and for a tab case the body of the tab as well. */
  renderCase(cx) {
    this.copy.render(cx);
    if (IS_TAB_CASE && this.copy.renderTabBody) this.copy.renderTabBody();
  }

  render(cx) {
    const startedAt = performance.now();
    if (CASE_NAME === "poll") {
      takePollLease(this.poller.copyId, Math.floor(Date.now() / 1000));
      this.poller.publish(this.snapshot);
    } else {
      this.renderCase(cx);
    }
    throw new Error(`QBENCH ${JSON.stringify({ ms: performance.now() - startedAt })}`);
  }
}

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeHerdr, resetFakeHerdr } from "herdr";
import { counters, resetCounters } from "./fakes/gpui.js";
import { ENGINE_CASES, parseCase } from "./engine.js";

const CONSOLE_WIDTH_PX = 640;
const STATE_KEY = "herdwatch.state";
const OLD_HISTORY_KEY = "herdwatch.history";
const RENDER_CASES = ENGINE_CASES.filter((spec) => !spec.startsWith("poll:"));

class CountingSharedState extends Map {
  writes = 0;
  bytes = 0;

  set(key, value) {
    this.writes++;
    this.bytes += JSON.stringify(value ?? null).length;
    return super.set(key, value);
  }
}

const fakeContext = () => ({ notify: () => {}, spawn: () => {}, timer: { every: () => {} }, new: () => ({}) });
/** The case "frame" draws the console frame on the overview tab. */
const tabOfCase = (caseName) => (caseName === "frame" ? "overview" : caseName);
const fakeFocusHandle = () => ({ is_focused: () => false, focus: () => {} });

/** @param {string} modDir */
async function importModModules(modDir) {
  const load = (name) => import(pathToFileURL(join(modDir, name)).href);
  const [main, poller, snapshot, store] = await Promise.all([load("main.js"), load("poller.js"), load("snapshot.js"), load("store.js")]);
  return { Herdwatch: main.default, Poller: poller.Poller, parseSnapshot: snapshot.parseSnapshot, takePollLease: store.takePollLease };
}

/** Puts the full history where this version of the mod keeps it: inside the state, or in a key of its own. */
function storeHistory(history) {
  const state = fakeHerdr.sharedState.get(STATE_KEY);
  if (state && "history" in state) fakeHerdr.sharedState.set(STATE_KEY, { ...state, history });
  else fakeHerdr.sharedState.set(OLD_HISTORY_KEY, history);
}

/** @param {Function} Herdwatch @param {string} caseName @param {number} range */
function benchCopy(Herdwatch, caseName, range) {
  return Object.assign(Object.create(Herdwatch.prototype), {
    role: caseName === "pill" ? "bar" : "console",
    width: CONSOLE_WIDTH_PX,
    choices: { host: null, tab: tabOfCase(caseName), range, filter: "all", sort: "cpu" },
    portNotes: {},
    focusHandle: fakeFocusHandle(),
    drawnClockKey: "",
    checkingPruneOn: null,
    showAllWorktrees: false,
  });
}

/** One redraw of a case: the frame, and for a tab case the body of the tab as well. */
function renderCase(copy, caseName) {
  copy.render(fakeContext());
  const isTabCase = caseName !== "pill" && caseName !== "frame";
  if (isTabCase && copy.renderTabBody) copy.renderTabBody();
}

/** The second render, after the first one filled any cache, as the console sees it on each redraw. */
function countRender(copy, caseName) {
  renderCase(copy, caseName);
  resetCounters();
  renderCase(copy, caseName);
  return { elements: counters.elements, hostCalls: counters.calls, pathOps: counters.pathOps };
}

/**
 * Node pass: elements and host calls of each render, and the shared writes of one poll in its steady state.
 * Node times say little about QuickJS, so this pass counts work instead of timing it.
 * @param {string} modDir @param {{ backendOutput: string, history: object }} fixture
 */
export async function measureStructure(modDir, fixture) {
  const { Herdwatch, Poller, parseSnapshot, takePollLease } = await importModModules(modDir);
  resetFakeHerdr();
  const parsed = parseSnapshot(fixture.backendOutput);
  if (parsed.ok === false) throw new Error(`bench fixture does not parse: ${parsed.failure.detail}`);
  const poller = new Poller();
  poller.publish(parsed.snapshot);
  storeHistory(fixture.history);
  const structure = Object.fromEntries(RENDER_CASES.map((spec) => {
    const { caseName, range, key } = parseCase(spec);
    const copy = benchCopy(Herdwatch, caseName, range);
    if (copy.role === "console" && copy.createTabBody) copy.createTabBody(fakeContext());
    return [key, countRender(copy, caseName)];
  }));
  const countingState = new CountingSharedState(fakeHerdr.sharedState);
  fakeHerdr.sharedState = countingState;
  countingState.writes = 0;
  countingState.bytes = 0;
  takePollLease(poller.copyId, Math.floor(Date.now() / 1000));
  poller.publish(parsed.snapshot);
  return { structure, poll: { sharedWrites: countingState.writes, sharedBytes: countingState.bytes } };
}

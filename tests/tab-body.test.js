import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { resetFakeHerdr } from "herdr";
import Herdwatch from "../mods/herdwatch/main.js";
import { Poller } from "../mods/herdwatch/poller.js";
import { snapshot } from "./support/snapshots.js";

const BODY = { name: "tab body" };

/** A stand-in for the GPUI context that records each notify and its target. */
function fakeContext() {
  const notified = [];
  return { notified, notify: (target) => notified.push(target ?? "self"), new: () => BODY, spawn: () => {}, timer: { every: () => {} } };
}

/** A console copy without its init, so no timer, poll or command loop starts. */
function consoleCopy() {
  const copy = Object.assign(Object.create(Herdwatch.prototype), {
    role: "console",
    width: 640,
    choices: { host: null, tab: "overview", range: 60, filter: "all", sort: "cpu" },
    portNotes: {},
    focusHandle: { is_focused: () => false, focus: () => {} },
    drawnClockKey: "",
    checkingPruneOn: null,
    showAllWorktrees: false,
  });
  copy.createTabBody(fakeContext());
  return copy;
}

beforeEach(() => {
  resetFakeHerdr();
  new Poller().publish(snapshot());
});

test("a body that was never drawn is built", () => {
  const copy = consoleCopy();
  const cx = fakeContext();
  copy.refreshShownBody(cx);
  assert.deepEqual(cx.notified, [BODY]);
});

test("a redraw of the frame does not build a current body again", () => {
  const copy = consoleCopy();
  copy.renderTabBody();
  const cx = fakeContext();
  copy.refreshShownBody(cx);
  copy.render();
  assert.deepEqual(cx.notified, []);
});

test("a click on a tab redraws the frame and builds the body, with the click's context", () => {
  const copy = consoleCopy();
  copy.renderTabBody();
  const clickCx = fakeContext();
  copy.consoleView("overview").onTab("ports", clickCx);
  assert.equal(copy.choices.tab, "ports");
  assert.deepEqual(clickCx.notified, ["self", BODY]);
});

test("new data builds the body at the next clock tick", () => {
  const copy = consoleCopy();
  copy.renderTabBody();
  new Poller().publish(snapshot({ generated_at: 1_900_000_000 }));
  const timerCx = fakeContext();
  copy.refreshClock(timerCx);
  assert.ok(timerCx.notified.includes(BODY));
});

test("a clock tick without new data does not build a current body", () => {
  const copy = consoleCopy();
  copy.renderTabBody();
  const timerCx = fakeContext();
  copy.refreshClock(timerCx);
  assert.ok(!timerCx.notified.includes(BODY));
});

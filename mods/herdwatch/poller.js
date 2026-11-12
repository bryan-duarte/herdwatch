import { notify, playSound } from "herdr";
import { measureWorktrees, runSnapshot } from "./backend.js";
import { nowInSeconds } from "./format.js";
import { SECONDS_PER_SAMPLE, nextHistory } from "./history.js";
import { publishPoll, publishPollError, publishWorktrees, readHistory, takePollLease } from "./store.js";
import { splitWorktrees, worktreesSignature } from "./worktrees.js";

/** @typedef {import("./schemas.js").HotHostAlert} HotHostAlert */
/** @typedef {import("./schemas.js").ModContext} ModContext */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */

const MILLISECONDS_PER_SECOND = 1000;
const POLL_INTERVAL_MS = SECONDS_PER_SAMPLE * MILLISECONDS_PER_SECOND;
const ALERT_SOUND = "blocked";

/** @param {HotHostAlert} alert */
function announceAlert(alert) {
  notify({
    title: `herdwatch: ${alert.label} is hot`,
    body: `CPU ${alert.cpu_pct ?? "?"}% · MEM ${alert.mem_pct ?? "?"}% · top: ${alert.top_process || "?"}`,
    level: "warning",
  });
  playSound(ALERT_SOUND);
}

const newCopyId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Polls the hosts every few seconds and publishes the results to Herdr's shared state, where every copy of the mod reads them.
 * Each copy runs a Poller; the poll lease lets one of them do the work.
 */
export class Poller {
  constructor() {
    this.copyId = newCopyId();
    this.isPolling = false;
    this.isMeasuringWorktrees = false;
    this.publishedWorktreesSignature = "";
  }

  /** @param {ModContext} cx */
  start(cx) {
    cx.timer.every(POLL_INTERVAL_MS, (timerCx) => this.tick(timerCx));
    this.tick(cx);
  }

  /**
   * The lease is renewed on each tick, also while a slow poll still runs, so no other copy starts a second poll.
   * @param {ModContext} cx
   */
  tick(cx) {
    const ownsLease = takePollLease(this.copyId, nowInSeconds());
    if (!ownsLease || this.isPolling) return;
    this.isPolling = true;
    cx.spawn(() => this.pollOnce(cx));
  }

  /** @param {ModContext} cx */
  async pollOnce(cx) {
    try {
      const outcome = await runSnapshot();
      if (outcome.ok === false) {
        publishPollError(outcome.error);
        return;
      }
      this.publish(outcome.snapshot);
      outcome.snapshot.alerts.forEach(announceAlert);
      if (outcome.snapshot.worktrees_due) this.startWorktreeMeasure(cx, outcome.snapshot.settings);
    } catch (pollError) {
      publishPollError(String(pollError));
    } finally {
      this.isPolling = false;
    }
  }

  /** @param {Snapshot} snapshot */
  publish(snapshot) {
    const { lightSnapshot, worktreesByHost } = splitWorktrees(snapshot);
    const signature = worktreesSignature(worktreesByHost);
    if (signature !== this.publishedWorktreesSignature) {
      this.publishedWorktreesSignature = signature;
      publishWorktrees(worktreesByHost);
    }
    publishPoll(lightSnapshot, nextHistory(readHistory(), snapshot, nowInSeconds()));
  }

  /** @param {ModContext} cx @param {MonitorSettings} settings */
  startWorktreeMeasure(cx, settings) {
    if (this.isMeasuringWorktrees) return;
    this.isMeasuringWorktrees = true;
    cx.spawn(async () => {
      const measure = await measureWorktrees(settings);
      if (measure.ok === false) console.log("herdwatch_worktree_measure_failed", measure.error);
      this.isMeasuringWorktrees = false;
    });
  }
}

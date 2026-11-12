import { notify, playSound } from "herdr";
import { measureDocker, measureWorktrees, runSnapshot } from "./backend.js";
import { dockerSignature, splitDocker } from "./docker.js";
import { nowInSeconds } from "./format.js";
import { SECONDS_PER_SAMPLE, nextHistory } from "./history.js";
import { publishDocker, publishPoll, publishPollError, publishWorktrees, readHistory, retireOldSharedKeys, takePollLease } from "./store.js";
import { splitWorktrees, worktreesSignature } from "./worktrees.js";

/** @typedef {import("./schemas.js").BackendRunResult} BackendRunResult */
/** @typedef {import("./schemas.js").HostAlert} HostAlert */
/** @typedef {import("./schemas.js").ModContext} ModContext */
/** @typedef {import("./schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */

const MILLISECONDS_PER_SECOND = 1000;
const POLL_INTERVAL_MS = SECONDS_PER_SAMPLE * MILLISECONDS_PER_SECOND;
const ALERT_SOUND = "blocked";

/** @param {HostAlert} alert */
function alertNotification(alert) {
  if (alert.kind === "port_down") {
    return { title: `herdwatch: :${alert.port} on ${alert.label} is down`, body: "The pinned port stopped listening." };
  }
  return {
    title: `herdwatch: ${alert.label} is hot`,
    body: `CPU ${alert.cpu_pct ?? "?"}% · MEM ${alert.mem_pct ?? "?"}% · top: ${alert.top_process || "?"}`,
  };
}

/** @param {HostAlert} alert */
function announceAlert(alert) {
  notify({ ...alertNotification(alert), level: "warning" });
  playSound(ALERT_SOUND);
}

/** @param {string} measureName @param {BackendRunResult} measure */
function logMeasureFailure(measureName, measure) {
  if (measure.ok === false) console.log("herdwatch_measure_failed", measureName, measure.failure.reason, measure.failure.detail);
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
    this.isMeasuringDocker = false;
    this.publishedWorktreesSignature = "";
    this.publishedDockerSignature = "";
  }

  /** @param {ModContext} cx */
  start(cx) {
    retireOldSharedKeys();
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
        publishPollError(outcome.failure);
        return;
      }
      this.publish(outcome.snapshot);
      outcome.snapshot.alerts.forEach(announceAlert);
      if (outcome.snapshot.worktrees_due) this.startWorktreeMeasure(cx, outcome.snapshot.settings);
      if (outcome.snapshot.docker_due) this.startDockerMeasure(cx);
    } catch (pollError) {
      publishPollError({ reason: "mod_bug", detail: String(pollError) });
    } finally {
      this.isPolling = false;
    }
  }

  /** @param {Snapshot} snapshot */
  publish(snapshot) {
    const { lightSnapshot: withoutWorktrees, worktreesByHost } = splitWorktrees(snapshot);
    const { lightSnapshot, dockerByHost } = splitDocker(withoutWorktrees);
    const currentWorktreesSignature = worktreesSignature(worktreesByHost);
    if (currentWorktreesSignature !== this.publishedWorktreesSignature) {
      this.publishedWorktreesSignature = currentWorktreesSignature;
      publishWorktrees(worktreesByHost);
    }
    const currentDockerSignature = dockerSignature(dockerByHost);
    if (currentDockerSignature !== this.publishedDockerSignature) {
      this.publishedDockerSignature = currentDockerSignature;
      publishDocker(dockerByHost);
    }
    const signatures = { worktrees: currentWorktreesSignature, docker: currentDockerSignature };
    publishPoll(lightSnapshot, nextHistory(readHistory(), snapshot, nowInSeconds()), signatures);
  }

  /** @param {ModContext} cx @param {MonitorSettings} settings */
  startWorktreeMeasure(cx, settings) {
    if (this.isMeasuringWorktrees) return;
    this.isMeasuringWorktrees = true;
    cx.spawn(async () => {
      logMeasureFailure("worktrees", await measureWorktrees(settings));
      this.isMeasuringWorktrees = false;
    });
  }

  /** @param {ModContext} cx */
  startDockerMeasure(cx) {
    if (this.isMeasuringDocker) return;
    this.isMeasuringDocker = true;
    cx.spawn(async () => {
      logMeasureFailure("docker", await measureDocker());
      this.isMeasuringDocker = false;
    });
  }
}

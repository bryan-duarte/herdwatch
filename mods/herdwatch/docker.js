import { isHostDocker, isRecord } from "./snapshot.js";

/** @typedef {import("./schemas.js").DockerByHost} DockerByHost */
/** @typedef {import("./schemas.js").DockerContainer} DockerContainer */
/** @typedef {import("./schemas.js").DockerImage} DockerImage */
/** @typedef {import("./schemas.js").DockerVolume} DockerVolume */
/** @typedef {import("./schemas.js").HostDocker} HostDocker */
/** @typedef {import("./schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./schemas.js").Snapshot} Snapshot */

/** @param {DockerContainer} container */
export const isRunningContainer = (container) => container.state === "running" || container.state === "restarting";

/**
 * The full lists live in their own shared key; the snapshot copy only has the totals.
 * @param {DockerByHost} dockerByHost
 * @param {HostSnapshot} host
 * @returns {HostDocker}
 */
export const dockerOfHost = (dockerByHost, host) => dockerByHost[host.label] ?? host.docker;

/**
 * Takes the Docker lists out of the snapshot, so the state that changes every poll stays small.
 * @param {Snapshot} snapshot
 * @returns {{ lightSnapshot: Snapshot, dockerByHost: DockerByHost }}
 */
export function splitDocker(snapshot) {
  const dockerByHost = Object.fromEntries(snapshot.hosts.map((host) => [host.label, host.docker]));
  const hosts = snapshot.hosts.map((host) => ({
    ...host,
    docker: {
      ...host.docker,
      containers: /** @type {DockerContainer[]} */ ([]),
      images: /** @type {DockerImage[]} */ ([]),
      volumes: /** @type {DockerVolume[]} */ ([]),
    },
  }));
  return { lightSnapshot: { ...snapshot, hosts }, dockerByHost };
}

/**
 * Changes when any host gets a new measure, so the Docker lists are written only then.
 * @param {DockerByHost} dockerByHost
 */
export function dockerSignature(dockerByHost) {
  return Object.entries(dockerByHost)
    .map(([label, docker]) => `${label}:${docker.state}:${docker.measured_at}:${docker.containers.length}:${docker.images.length}`)
    .sort()
    .join("|");
}

/**
 * @param {unknown} stored
 * @returns {DockerByHost}
 */
export function dockerOrEmpty(stored) {
  if (!isRecord(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([, docker]) => isHostDocker(docker)));
}

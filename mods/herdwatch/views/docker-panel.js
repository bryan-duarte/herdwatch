import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { dockerOfHost, isRunningContainer } from "../docker.js";
import { measureGuidance } from "../failure-guidance.js";
import { age, ageSince, storageSize } from "../format.js";
import { TOKYO_NIGHT } from "../palette.js";
import { fixedCell, panel, panelTitle, rightCell, rowButton, text, textButton, titleRow, truncatedText } from "./widgets.js";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").DockerContainer} DockerContainer */
/** @typedef {import("../schemas.js").HostDocker} HostDocker */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */

const ROW_HEIGHT_PX = 24;
const COLUMN_WIDTH_PX = { dot: 12, name: 150, state: 64, age: 40, size: 64, action: 18 };
const RUNNING_DOT = "●";
const STOPPED_DOT = "○";
const SHORT_CONTAINER_ID_LENGTH = 12;
const FOOTNOTE_TEXT_SIZE_PX = 10.5;

/** @param {DockerContainer} first @param {DockerContainer} second */
const runningFirstThenByName = (first, second) =>
  Number(isRunningContainer(second)) - Number(isRunningContainer(first)) || first.name.localeCompare(second.name);

/** @param {DockerContainer} container @param {ConsoleView} view @param {HostSnapshot} host */
function containerAction(container, view, host) {
  if (isRunningContainer(container)) {
    return rowButton({ id: `docker-stop-${container.id}`, glyph: "square", hoverColor: TOKYO_NIGHT.yellow, tooltip: `Stop ${container.name}`, onPress: () => view.onDockerContainer(host, container, "docker-stop") });
  }
  return rowButton({ id: `docker-rm-${container.id}`, glyph: "trash-2", hoverColor: TOKYO_NIGHT.red, tooltip: `Remove ${container.name}`, onPress: () => view.onDockerContainer(host, container, "docker-rm") });
}

/** @param {DockerContainer} container @param {ConsoleView} view @param {HostSnapshot} host */
function containerRow(container, view, host) {
  const isRunning = isRunningContainer(container);
  return h_flex().id(`docker-${container.id}`).h(ROW_HEIGHT_PX).flex_none().gap(8).items_center().tooltip(`${container.name} · ${container.image} · ${container.id.slice(0, SHORT_CONTAINER_ID_LENGTH)}`)
    .child(fixedCell(COLUMN_WIDTH_PX.dot).child(text(isRunning ? RUNNING_DOT : STOPPED_DOT, isRunning ? TOKYO_NIGHT.green : TOKYO_NIGHT.comment)))
    .child(fixedCell(COLUMN_WIDTH_PX.name).truncate().text_color(TOKYO_NIGHT.foreground).child(container.name))
    .child(truncatedText(container.image, TOKYO_NIGHT.foregroundDark).flex_1())
    .child(fixedCell(COLUMN_WIDTH_PX.state).child(text(container.state, isRunning ? TOKYO_NIGHT.green : TOKYO_NIGHT.comment)))
    .child(rightCell(Number.isFinite(container.created_at) ? ageSince(container.created_at).replace(" ago", "") : "?", COLUMN_WIDTH_PX.age, TOKYO_NIGHT.comment))
    .child(rightCell(storageSize(container.size_kb), COLUMN_WIDTH_PX.size, TOKYO_NIGHT.comment))
    .child(fixedCell(COLUMN_WIDTH_PX.action).child(containerAction(container, view, host)));
}

/** @param {HostDocker} docker */
function storageLine(docker) {
  const imagesKib = docker.images.reduce((sum, image) => sum + (image.size_kb ?? 0), 0);
  const volumesKib = docker.volumes.reduce((sum, volume) => sum + (volume.size_kb ?? 0), 0);
  const unusedVolumes = docker.volumes.filter((volume) => volume.is_unused).length;
  const danglingImages = docker.images.filter((image) => image.is_dangling).length;
  return `images ${storageSize(imagesKib)} (${docker.images.length}, ${danglingImages} untagged) · volumes ${storageSize(volumesKib)} (${docker.volumes.length}, ${unusedVolumes} unused)`;
}

/** @param {HostDocker} docker @param {HostSnapshot} host @param {MonitorSettings} settings */
function failedMeasureMessage(docker, host, settings) {
  const { summary, nextStep } = docker.reason
    ? measureGuidance("Docker", docker, host, settings)
    : { summary: "Docker did not answer.", nextStep: "Check that the Docker daemon runs on the host." };
  return `${summary}${docker.error ? ` (${docker.error})` : ""} Next: ${nextStep}`;
}

/**
 * @param {HostDocker} docker @param {HostSnapshot} host @param {MonitorSettings} settings
 * @returns {{ color: Color, message: string } | null}
 */
function stateNotice(docker, host, settings) {
  if (docker.state === "off") return { color: TOKYO_NIGHT.comment, message: "The Docker tab is off. Set DOCKER=on in settings.conf to turn it on." };
  if (docker.state === "missing") return { color: TOKYO_NIGHT.comment, message: `Docker is not installed on ${host.label}.` };
  if (docker.state === "denied") {
    return { color: TOKYO_NIGHT.yellow, message: `The SSH user of ${host.label} cannot reach Docker. Add it to the docker group, then log in again.` };
  }
  if (docker.state === "pending") return { color: TOKYO_NIGHT.comment, message: `Measuring Docker. A measure runs every ${age(settings.docker_interval)}.` };
  if (docker.state === "failed") return { color: TOKYO_NIGHT.red, message: failedMeasureMessage(docker, host, settings) };
  return null;
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {HostDocker} docker */
function containerList(view, host, docker) {
  if (!docker.containers.length) return div().text_color(TOKYO_NIGHT.comment).child("No containers.");
  const ordered = [...docker.containers].sort(runningFirstThenByName);
  return v_flex().id(`docker-containers-${host.label}`).flex_1().min_h(0).gap(2).overflow_y_scrollbar()
    .children(ordered.map((container) => containerRow(container, view, host)));
}

const dockerTitle = () => panelTitle("container", "docker", TOKYO_NIGHT.blue);

/**
 * Containers, images and volumes of the host, with the space that prune frees. Stop, remove and prune ask first.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
export function dockerPanel(view, host, settings) {
  const docker = dockerOfHost(view.docker, host);
  const notice = stateNotice(docker, host, settings);
  const hasLists = docker.containers.length + docker.images.length + docker.volumes.length > 0;
  const statusLine = notice ? [div().text_color(notice.color).child(notice.message)] : [];
  if (!hasLists) {
    const emptyBody = statusLine.length ? statusLine : [text("No Docker data yet.", TOKYO_NIGHT.comment)];
    return panel({ id: `docker-${host.label}`, title: dockerTitle(), body: emptyBody });
  }
  const title = titleRow(dockerTitle(), text(storageSize(docker.total_kb), TOKYO_NIGHT.foreground),
    text(`· ${storageSize(docker.reclaimable_kb)} can be freed`, TOKYO_NIGHT.comment));
  const runningCount = docker.containers.filter(isRunningContainer).length;
  const body = [
    ...statusLine,
    h_flex().gap(8).items_center().justify_between()
      .child(text(`containers · ${runningCount} running of ${docker.containers.length}`, TOKYO_NIGHT.comment))
      .child(textButton({ id: `docker-prune-${host.label}`, label: `prune ${storageSize(docker.reclaimable_kb)}`, tooltip: "Delete unused images, and volumes if you tick them. The dialog shows the space first.", onPress: (cx) => view.onDockerPrune(host, cx) })),
    containerList(view, host, docker),
    text(storageLine(docker), TOKYO_NIGHT.comment).text_size(FOOTNOTE_TEXT_SIZE_PX),
    text(`measured ${ageSince(docker.measured_at)} · every ${age(settings.docker_interval)}`, TOKYO_NIGHT.comment).text_size(FOOTNOTE_TEXT_SIZE_PX),
  ];
  return panel({ id: `docker-${host.label}`, title, rightTitle: text(ageSince(docker.measured_at), TOKYO_NIGHT.comment), body, fill: true });
}

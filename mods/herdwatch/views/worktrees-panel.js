import { div, uniform_list } from "gpui-kit";
import { h_flex } from "gpui-base";
import { age, ageSince, daysSince, storageSize } from "../format.js";
import { GRADIENTS, TOKYO_NIGHT, gradientAt } from "../palette.js";
import { WORKTREE_FILTERS, WORKTREE_FILTER_NAMES, hasAgentIn, isStaleWorktree, worktreeTotals, worktreesOfHost } from "../worktrees.js";
import { AGENT_MARKER, MARK_ONLY_COLUMN_PX, agentLabel, filterChips, panelTitle, uiIcon, fixedCell, meter, panel, rightCell, text, titleRow, truncatedText } from "./widgets.js";

/** @typedef {import("../schemas.js").AgentView} AgentView */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").HostWorktrees} HostWorktrees */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("../schemas.js").WorktreeItem} WorktreeItem */

const PERCENT_SCALE = 100;
const ROW_HEIGHT_PX = 26;
/** @type {Record<import("../schemas.js").WorktreeFilter, import("./widgets.js").UiGlyph>} */
const FILTER_GLYPHS = { all: "layers", stale: "archive", changed: "file-diff", agent: "bot", behind: "arrow-down-to-line" };
const SIZE_METER_CELLS = 5;
const COLUMN_WIDTH_PX = { size: 64, tool: 96, wideRepository: 110, narrowRepository: 80, changes: 52, age: 40 };

/**
 * @typedef {object} WorktreeRowContext
 * @property {AgentView[]} agents
 * @property {number} largestKib
 * @property {boolean} isWide
 */

/** @param {WorktreeItem} worktree @param {WorktreeRowContext} context */
function worktreeRow(worktree, { agents, largestKib, isWide }) {
  const sizePercent = largestKib > 0 ? ((worktree.size_kb ?? 0) / largestKib) * PERCENT_SCALE : 0;
  const days = daysSince(worktree.last_commit_at);
  const changedFiles = worktree.changed_files ?? 0;
  const hasChanges = changedFiles > 0;
  return h_flex().id(`wt-${worktree.absolute_path}`).w_full().h(ROW_HEIGHT_PX).px(8).gap(8).items_center()
    .border_b(1).border_color(TOKYO_NIGHT.highlight)
    .tooltip(`${worktree.path} · ↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}`)
    .child(rightCell(storageSize(worktree.size_kb), COLUMN_WIDTH_PX.size, gradientAt(GRADIENTS.storage, sizePercent / PERCENT_SCALE)))
    .when(isWide, (element) => element.child(meter(sizePercent, SIZE_METER_CELLS, GRADIENTS.storage)))
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.tool : MARK_ONLY_COLUMN_PX).child(agentLabel(`wt-tool-${worktree.absolute_path}`, worktree.tool, isWide)))
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.wideRepository : COLUMN_WIDTH_PX.narrowRepository).truncate().text_color(TOKYO_NIGHT.blue).child(worktree.repository))
    .child(h_flex().flex_1().min_w(0).gap(4)
      .when(hasAgentIn(worktree, agents), (element) => element.child(text(AGENT_MARKER, TOKYO_NIGHT.green)))
      .child(truncatedText(worktree.branch, TOKYO_NIGHT.foreground)))
    .child(rightCell(hasChanges ? `±${changedFiles}` : "clean", COLUMN_WIDTH_PX.changes, hasChanges ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.comment))
    .child(rightCell(days === null ? "?" : `${days}d`, COLUMN_WIDTH_PX.age, isStaleWorktree(worktree, agents) ? TOKYO_NIGHT.orange : TOKYO_NIGHT.comment));
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {WorktreeItem[]} shownWorktrees @param {WorktreeRowContext} context */
function worktreeList(view, host, shownWorktrees, context) {
  if (!shownWorktrees.length) return div().p(10).text_color(TOKYO_NIGHT.comment).child("No worktree matches this filter.");
  return div().flex_1().min_h(0).rounded(6).border_1().border_color(TOKYO_NIGHT.highlight).bg(TOKYO_NIGHT.backgroundDark).overflow_hidden()
    .child(uniform_list(
      `worktrees-${host.label}-${view.worktreeFilter}`,
      shownWorktrees.length,
      (index) => shownWorktrees[index].absolute_path,
      (range) => shownWorktrees.slice(range.start, range.end).map((worktree) => worktreeRow(worktree, context)),
    ).size_full());
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {WorktreeItem[]} worktrees */
function filterRow(view, host, worktrees) {
  const options = WORKTREE_FILTER_NAMES.map((name) => ({
    value: name,
    label: WORKTREE_FILTERS[name].label,
    glyph: FILTER_GLYPHS[name],
    tooltip: WORKTREE_FILTERS[name].tooltip,
    count: worktrees.filter((worktree) => WORKTREE_FILTERS[name].matches(worktree, view.agents)).length,
  }));
  return filterChips({ id: `worktree-filters-${host.label}`, options, selected: view.worktreeFilter, onSelect: view.onWorktreeFilter });
}

/** @param {HostSnapshot} host @param {MonitorSettings} settings */
function measuringPanel(host, settings) {
  const message = `Measuring worktrees. A measure runs every ${age(settings.worktree_interval)} and can take up to ${age(settings.worktree_timeout)}.`;
  return panel({ id: `worktrees-${host.label}`, title: panelTitle("folder-git-2", "worktrees", TOKYO_NIGHT.teal), body: [text(message, TOKYO_NIGHT.comment)] });
}

/**
 * The git worktrees on the host, largest first, with filters and the space that stale worktrees hold.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
export function worktreesPanel(view, host, settings) {
  const worktrees = worktreesOfHost(view.worktrees, host);
  const isFirstMeasure = worktrees.state === "pending" && !worktrees.items.length;
  if (isFirstMeasure) return measuringPanel(host, settings);
  const filter = WORKTREE_FILTERS[view.worktreeFilter];
  const shownWorktrees = worktrees.items.filter((worktree) => filter.matches(worktree, view.agents));
  const { largestKib, reclaimableKib } = worktreeTotals(worktrees.items, view.agents);
  const context = { agents: view.agents, largestKib, isWide: view.isWide };
  const measuredText = `${shownWorktrees.length} of ${worktrees.items.length} worktrees · measured ${ageSince(worktrees.measured_at)} · every ${age(settings.worktree_interval)}`;
  const body = [
    h_flex().gap(8).flex_wrap().justify_between().items_center()
      .child(filterRow(view, host, worktrees.items))
      .child(titleRow(uiIcon("archive").text_color(TOKYO_NIGHT.orange), text("reclaimable from stale:", TOKYO_NIGHT.comment), text(storageSize(reclaimableKib), TOKYO_NIGHT.orange))),
    worktreeList(view, host, shownWorktrees, context),
    text(measuredText, TOKYO_NIGHT.comment).text_size(10.5),
  ];
  if (worktrees.state === "failed") body.unshift(text(`Last measure failed: ${worktrees.error}`, TOKYO_NIGHT.red));
  return panel({
    id: `worktrees-${host.label}`,
    title: titleRow(panelTitle("folder-git-2", "worktrees", TOKYO_NIGHT.teal), text(storageSize(worktrees.total_kb), TOKYO_NIGHT.foreground)),
    rightTitle: text(ageSince(worktrees.measured_at), TOKYO_NIGHT.comment),
    body,
    fill: true,
  });
}

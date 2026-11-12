import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { measureGuidance } from "../failure-guidance.js";
import { age, ageSince, daysSince, storageSize } from "../format.js";
import { GRADIENTS, TOKYO_NIGHT, gradientAt } from "../palette.js";
import { WORKTREE_FILTERS, WORKTREE_FILTER_NAMES, deleteCheckFor, isMergedWorktree, worktreeFacts, worktreesOfHost } from "../worktrees.js";
import { AGENT_MARKER, MARK_ONLY_COLUMN_PX, agentLabel, filterChips, panelTitle, uiIcon, fixedCell, meter, panel, rightCell, rowButton, text, textButton, titleRow, truncatedText } from "./widgets.js";

/** @typedef {import("../schemas.js").AgentView} AgentView */
/** @typedef {import("../schemas.js").ConsoleView} ConsoleView */
/** @typedef {import("../schemas.js").HostSnapshot} HostSnapshot */
/** @typedef {import("../schemas.js").HostWorktrees} HostWorktrees */
/** @typedef {import("../schemas.js").MonitorSettings} MonitorSettings */
/** @typedef {import("../schemas.js").WorktreeFacts} WorktreeFacts */
/** @typedef {import("../schemas.js").WorktreeItem} WorktreeItem */

const PERCENT_SCALE = 100;
const ROW_HEIGHT_PX = 26;
/** @type {Record<import("../schemas.js").WorktreeFilter, import("./widgets.js").UiGlyph>} */
const FILTER_GLYPHS = { all: "layers", stale: "archive", merged: "git-merge", changed: "file-diff", agent: "bot", behind: "arrow-down-to-line" };
const SIZE_METER_CELLS = 5;
/** Each row is about 22 elements and redraws on every poll, so the list draws this many until "show more". */
const ROWS_BEFORE_MORE = 40;
const COLUMN_WIDTH_PX = { size: 64, tool: 96, wideRepository: 110, narrowRepository: 80, changes: 52, age: 40, delete: 18 };

/**
 * @typedef {object} WorktreeRowContext
 * @property {ConsoleView} view
 * @property {HostSnapshot} host
 * @property {WorktreeFacts} facts
 */

/** @param {WorktreeItem} worktree */
function worktreeTooltip(worktree) {
  const created = Number.isFinite(worktree.created_at) ? `created ${ageSince(worktree.created_at)}` : "created ?";
  const activity = Number.isFinite(worktree.last_activity_at) ? `last git activity ${ageSince(worktree.last_activity_at)}` : "last git activity ?";
  return `${worktree.path} · ${created} · ${activity} · ↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}`;
}

/** @param {WorktreeItem} worktree @param {WorktreeRowContext} context @param {boolean} hasAgent */
function deleteButton(worktree, { view, host }, hasAgent) {
  const { canDelete, reason } = deleteCheckFor(hasAgent);
  return rowButton({
    id: `wt-delete-${worktree.absolute_path}`,
    glyph: "trash-2",
    hoverColor: TOKYO_NIGHT.red,
    tooltip: reason,
    isDisabled: !canDelete,
    onPress: () => view.onDeleteWorktree(host, worktree),
  });
}

/** @param {WorktreeItem} worktree @param {WorktreeRowContext} context */
function worktreeRow(worktree, context) {
  const { view, facts } = context;
  const { isWide } = view;
  const { largestKib } = facts;
  const { hasAgent, isStale } = facts.flagsOfWorktree.get(worktree);
  const sizePercent = largestKib > 0 ? ((worktree.size_kb ?? 0) / largestKib) * PERCENT_SCALE : 0;
  const days = daysSince(worktree.last_commit_at);
  const changedFiles = worktree.changed_files ?? 0;
  const hasChanges = changedFiles > 0;
  return h_flex().id(`wt-${worktree.absolute_path}`).w_full().h(ROW_HEIGHT_PX).flex_none().px(8).gap(8).items_center()
    .border_b(1).border_color(TOKYO_NIGHT.highlight)
    .tooltip(worktreeTooltip(worktree))
    .child(rightCell(storageSize(worktree.size_kb), COLUMN_WIDTH_PX.size, gradientAt(GRADIENTS.storage, sizePercent / PERCENT_SCALE)))
    .when(isWide, (element) => element.child(meter(sizePercent, SIZE_METER_CELLS, GRADIENTS.storage)))
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.tool : MARK_ONLY_COLUMN_PX).child(agentLabel(`wt-tool-${worktree.absolute_path}`, worktree.tool, isWide)))
    .child(fixedCell(isWide ? COLUMN_WIDTH_PX.wideRepository : COLUMN_WIDTH_PX.narrowRepository).truncate().text_color(TOKYO_NIGHT.blue).child(worktree.repository))
    .child(h_flex().flex_1().min_w(0).gap(4)
      .when(hasAgent, (element) => element.child(text(AGENT_MARKER, TOKYO_NIGHT.green)))
      .child(truncatedText(worktree.branch, TOKYO_NIGHT.foreground))
      .when(isMergedWorktree(worktree), (element) => element.child(text("merged", TOKYO_NIGHT.green))))
    .child(rightCell(hasChanges ? `±${changedFiles}` : "clean", COLUMN_WIDTH_PX.changes, hasChanges ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.comment))
    .child(rightCell(days === null ? "?" : `${days}d`, COLUMN_WIDTH_PX.age, isStale ? TOKYO_NIGHT.orange : TOKYO_NIGHT.comment))
    .child(fixedCell(COLUMN_WIDTH_PX.delete).child(deleteButton(worktree, context, hasAgent)));
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {number} hiddenCount */
const showMoreRow = (view, host, hiddenCount) => h_flex().w_full().flex_none().p(8).justify_center()
  .child(textButton({ id: `worktrees-more-${host.label}`, label: `show ${hiddenCount} more`, tooltip: "Show every worktree that matches this filter", onPress: view.onShowAllWorktrees }));

/**
 * A plain scroll list, not a virtual list: Herdr refuses click handlers inside a virtual list row, and each row has a
 * delete button. The list draws ROWS_BEFORE_MORE rows until "show more", because every drawn row redraws on each poll.
 * @param {ConsoleView} view @param {HostSnapshot} host @param {WorktreeItem[]} shownWorktrees @param {WorktreeRowContext} context
 */
function worktreeList(view, host, shownWorktrees, context) {
  if (!shownWorktrees.length) return div().p(10).text_color(TOKYO_NIGHT.comment).child("No worktree matches this filter.");
  const drawnWorktrees = view.showAllWorktrees ? shownWorktrees : shownWorktrees.slice(0, ROWS_BEFORE_MORE);
  const hiddenCount = shownWorktrees.length - drawnWorktrees.length;
  return v_flex().id(`worktrees-${host.label}-${view.worktreeFilter}`).flex_1().min_h(0).rounded(6).border_1()
    .border_color(TOKYO_NIGHT.highlight).bg(TOKYO_NIGHT.backgroundDark).overflow_y_scrollbar()
    .children(drawnWorktrees.map((worktree) => worktreeRow(worktree, context)))
    .when(hiddenCount > 0, (element) => element.child(showMoreRow(view, host, hiddenCount)));
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {WorktreeFacts} facts */
function filterRow(view, host, facts) {
  const options = WORKTREE_FILTER_NAMES.map((name) => ({
    value: name,
    label: WORKTREE_FILTERS[name].label,
    glyph: FILTER_GLYPHS[name],
    tooltip: WORKTREE_FILTERS[name].tooltip,
    count: facts.counts[name],
  }));
  return filterChips({ id: `worktree-filters-${host.label}`, options, selected: view.worktreeFilter, onSelect: view.onWorktreeFilter });
}

/** @param {HostSnapshot} host @param {MonitorSettings} settings */
function measuringPanel(host, settings) {
  const message = `Measuring worktrees. A measure runs every ${age(settings.worktree_interval)} and can take up to ${age(settings.worktree_timeout)}.`;
  return panel({ id: `worktrees-${host.label}`, title: panelTitle("folder-git-2", "worktrees", TOKYO_NIGHT.teal), body: [text(message, TOKYO_NIGHT.comment)] });
}

/**
 * A failed measure, or roots that the host does not have. The rows of the last good measure stay.
 * @param {HostWorktrees} worktrees @param {HostSnapshot} host @param {MonitorSettings} settings
 */
function measureNote(worktrees, host, settings) {
  const hasProblem = worktrees.state === "failed" || Boolean(worktrees.reason);
  if (!hasProblem) return [];
  const { summary, nextStep } = measureGuidance("worktree", worktrees, host, settings);
  const color = worktrees.state === "failed" ? TOKYO_NIGHT.red : TOKYO_NIGHT.yellow;
  const detail = worktrees.state === "failed" && worktrees.error ? ` (${worktrees.error})` : "";
  return [div().text_color(color).child(`${summary}${detail} Next: ${nextStep}`)];
}

/**
 * The git worktrees on the host, largest first, with filters, the space that stale worktrees hold, and a delete button.
 * @param {ConsoleView} view
 * @param {HostSnapshot} host
 * @param {MonitorSettings} settings
 */
export function worktreesPanel(view, host, settings) {
  const worktrees = worktreesOfHost(view.worktrees, host);
  const isFirstMeasure = worktrees.state === "pending" && !worktrees.items.length;
  if (isFirstMeasure) return measuringPanel(host, settings);
  const facts = worktreeFacts(worktrees.items, view.agents);
  const shownWorktrees = worktrees.items.filter((worktree) => facts.flagsOfWorktree.get(worktree).filters.has(view.worktreeFilter));
  const context = { view, host, facts };
  const measuredText = `${shownWorktrees.length} of ${worktrees.items.length} worktrees · measured ${ageSince(worktrees.measured_at)} · every ${age(settings.worktree_interval)}`;
  const body = [
    ...measureNote(worktrees, host, settings),
    h_flex().gap(8).flex_wrap().justify_between().items_center()
      .child(filterRow(view, host, facts))
      .child(titleRow(uiIcon("archive").text_color(TOKYO_NIGHT.orange), text("reclaimable from stale:", TOKYO_NIGHT.comment), text(storageSize(facts.reclaimableKib), TOKYO_NIGHT.orange))),
    worktreeList(view, host, shownWorktrees, context),
    text(measuredText, TOKYO_NIGHT.comment).text_size(10.5),
  ];
  return panel({
    id: `worktrees-${host.label}`,
    title: titleRow(panelTitle("folder-git-2", "worktrees", TOKYO_NIGHT.teal), text(storageSize(worktrees.total_kb), TOKYO_NIGHT.foreground)),
    rightTitle: text(ageSince(worktrees.measured_at), TOKYO_NIGHT.comment),
    body,
    fill: true,
  });
}

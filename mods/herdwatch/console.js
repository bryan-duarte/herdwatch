import { div, uniform_list } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { areaChart, coreStrip, sparkline } from "./charts.js";
import { age, ageSince, byteRate, daysSince, homeRelative, isStale, kibAsGib, level, levelColor, nowInSeconds, percentText, storageSize } from "./format.js";
import { GRADIENTS, TOKYO_NIGHT, gradientAt, toolColor } from "./palette.js";
import { chip, filterChips, iconButton, keycap, meter, panel, segmentedControl, superscript, tabStrip, text, titleRow } from "./widgets.js";

/** @typedef {import("./types.js").ConsoleView} ConsoleView */
/** @typedef {import("./types.js").ConsoleTab} ConsoleTab */
/** @typedef {import("./types.js").HostSnapshot} HostSnapshot */
/** @typedef {import("./types.js").MonitorSettings} MonitorSettings */
/** @typedef {import("./types.js").ProcessRow} ProcessRow */
/** @typedef {import("./types.js").ProcessSort} ProcessSort */
/** @typedef {import("./types.js").WorktreeItem} WorktreeItem */
/** @typedef {import("./types.js").WorktreeFilter} WorktreeFilter */
/** @typedef {import("./types.js").HostWorktrees} HostWorktrees */
/** @typedef {import("./types.js").AgentView} AgentView */
/** @typedef {import("./types.js").AgentState} AgentState */
/** @typedef {import("./types.js").HostEvent} HostEvent */
/** @typedef {import("./types.js").Element} Element */
/** @typedef {import("gpui-kit").Color} Color */

const PERCENT_SCALE = 100;
const CHART_HEIGHT_PX = 58;
const DISK_METER_CELLS = 20;
const PROCESS_METER_CELLS = 5;
const WORKTREE_METER_CELLS = 5;
const METER_CELL_STEP_PX = 7;
const LABEL_WIDTH_PX = 38;
const PERCENT_WIDTH_PX = 44;
const WIDE_PANE_PX = 560;
const MANY_CORES = 16;
const WIDE_CORE_CELL_PX = 10;
const NARROW_CORE_CELL_PX = 6;
const NET_SPARKLINE_WIDTH_PX = 70;
const NET_SPARKLINE_HEIGHT_PX = 16;
const AGENT_SPARKLINE_WIDTH_PX = 110;
const AGENT_SPARKLINE_HEIGHT_PX = 18;
const AGENT_HISTORY_SLOTS = 30;
const WORKTREE_ROW_HEIGHT_PX = 26;
const STALE_DAYS = 14;
const PROCESS_TABLE_MAX_WIDTH_PX = 820;
const AGENT_MARKER = "●";
const SORT_MARKER = "▾";
const CLOSE_ICON = "mods/workspace-chrome/x.svg";
const RANGE_OPTIONS = [
  { value: "24", label: "2m", tooltip: "Show the last 2 minutes" },
  { value: "60", label: "5m", tooltip: "Show the last 5 minutes" },
  { value: "120", label: "10m", tooltip: "Show the last 10 minutes" },
];
const SORT_OPTIONS = /** @type {{ value: ProcessSort, label: string, tooltip: string }[]} */ ([
  { value: "cpu", label: "CPU", tooltip: "Sort processes by CPU (c)" },
  { value: "mem", label: "MEM", tooltip: "Sort processes by memory (m)" },
]);
/** @type {Record<AgentState, { label: string, color: Color }>} */
const AGENT_STATES = {
  working: { label: "working", color: TOKYO_NIGHT.blue },
  blocked: { label: "needs you", color: TOKYO_NIGHT.yellow },
  idle: { label: "idle", color: TOKYO_NIGHT.comment },
  done: { label: "done", color: TOKYO_NIGHT.green },
};
/** @type {Record<HostEvent["kind"], Color>} */
const EVENT_COLORS = { start: TOKYO_NIGHT.blue, done: TOKYO_NIGHT.green, alert: TOKYO_NIGHT.red };

/** @param {string} content @param {number} width @param {Color} color */
const rightCell = (content, width, color) => div().w(width).flex_none().text_right().text_color(color).child(content);

/** @param {string} label */
const rowLabel = (label) => div().w(LABEL_WIDTH_PX).flex_none().text_color(TOKYO_NIGHT.comment).child(label);

/** @param {number | null} value */
const gradientPosition = (value) => (Number.isFinite(value) ? Math.min(value, PERCENT_SCALE) / PERCENT_SCALE : 0);

/** @param {HostSnapshot} host @param {MonitorSettings} settings */
export function hostDotColor(host, settings) {
  if (host.state === "down") return TOKYO_NIGHT.red;
  if (host.state === "auth") return TOKYO_NIGHT.yellow;
  if (host.state === "pending") return TOKYO_NIGHT.comment;
  const worst = Math.max(host.cpu_pct ?? 0, host.mem_pct ?? 0);
  return worst >= settings.crit ? TOKYO_NIGHT.red : worst >= settings.warn ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.green;
}

/** @param {WorktreeItem} worktree @param {AgentView[]} agents */
const hasAgentIn = (worktree, agents) => agents.some(({ process }) => process.cwd === worktree.absolute_path || process.cwd.startsWith(`${worktree.absolute_path}/`));

/** @param {WorktreeItem} worktree @param {AgentView[]} agents */
const isStaleWorktree = (worktree, agents) => (daysSince(worktree.last_commit_at) ?? 0) > STALE_DAYS && !hasAgentIn(worktree, agents);

/** @type {Record<WorktreeFilter, { label: string, tooltip: string, test: (worktree: WorktreeItem, agents: AgentView[]) => boolean }>} */
const WORKTREE_FILTERS = {
  all: { label: "all", tooltip: "Show every worktree", test: () => true },
  stale: { label: "stale > 14d", tooltip: "No commit for 14 days and no agent in it", test: isStaleWorktree },
  changed: { label: "uncommitted", tooltip: "Worktrees with uncommitted changes", test: (worktree) => (worktree.changed_files ?? 0) > 0 },
  agent: { label: "agent running", tooltip: "Worktrees where an agent works now", test: hasAgentIn },
  behind: { label: "behind upstream", tooltip: "Worktrees behind their upstream branch", test: (worktree) => (worktree.behind ?? 0) > 0 },
};

/** @param {ConsoleView} view @returns {HostWorktrees | null} */
const worktreesOf = (view) => (view.host ? view.worktrees[view.host.label] ?? view.host.worktrees : null);

/* ---------- header, tabs, footer ---------- */

/** @param {ConsoleView} view */
function header(view) {
  const snapshot = view.monitorState?.snapshot;
  const hosts = snapshot?.hosts ?? [];
  const hostOptions = hosts.map((host, index) => ({
    value: host.label, label: host.label, tooltip: `Show ${host.label} (${index + 1})`, dotColor: snapshot ? hostDotColor(host, snapshot.settings) : null,
  }));
  return h_flex().h(40).flex_none().px(10).gap(8).items_center().min_w(0).bg(TOKYO_NIGHT.backgroundDark).border_b(1).border_color(TOKYO_NIGHT.highlight)
    .child(text("herdwatch", TOKYO_NIGHT.foreground).font_semibold())
    .when(hosts.length > 0 && Boolean(view.host), (element) => element.child(tabStrip({ id: "hosts", options: hostOptions, selected: view.host.label, onSelect: view.onHost })))
    .child(div().flex_1())
    .child(segmentedControl({ id: "range", options: RANGE_OPTIONS, selected: String(view.rangeSamples), onSelect: (value) => view.onRange(Number(value)) }))
    .child(iconButton({
      id: "close-detail", icon: CLOSE_ICON, hoverColor: TOKYO_NIGHT.red, onPress: view.onClose,
      tooltip: view.shortcut ? `Close Herdwatch (${view.shortcut})` : "Close Herdwatch",
    }));
}

/** @param {ConsoleView} view */
function consoleTabs(view) {
  const host = view.host;
  const worktrees = worktreesOf(view);
  /** @type {{ value: ConsoleTab, label: string, count?: number | null, tooltip: string }[]} */
  const options = [
    { value: "overview", label: "overview", tooltip: "Charts and totals" },
    { value: "agents", label: "agents", count: host?.agents.length ?? 0, tooltip: "Coding agent sessions on this host" },
    { value: "ports", label: "ports", count: host?.ports.length ?? 0, tooltip: "Listening ports and the agent that owns each" },
    { value: "worktrees", label: "worktrees", count: worktrees?.items.length ?? 0, tooltip: "Git worktrees, size and health" },
    { value: "procs", label: "procs", count: view.monitorState?.snapshot?.settings.top_n ?? null, tooltip: "Top processes" },
  ];
  return div().px(10).pt(6).pb(6).flex_none().bg(TOKYO_NIGHT.backgroundDark).border_b(1).border_color(TOKYO_NIGHT.highlight)
    .child(tabStrip({ id: "console-tabs", options, selected: view.tab, onSelect: view.onTab }));
}

/** @param {ConsoleView} view */
function footer(view) {
  const keysHint = view.hasKeyboard ? "keys on" : "click the pane for keys";
  return h_flex().h(30).flex_none().px(10).gap(8).items_center().overflow_hidden().text_size(11)
    .bg(TOKYO_NIGHT.backgroundDark).border_t(1).border_color(TOKYO_NIGHT.highlight)
    .child(text(AGENT_MARKER, TOKYO_NIGHT.green)).child(text("agent", TOKYO_NIGHT.comment))
    .child(text("│", TOKYO_NIGHT.border))
    .child(keycap("c", view.hasKeyboard)).child(text("cpu", TOKYO_NIGHT.comment))
    .child(keycap("m", view.hasKeyboard)).child(text("mem", TOKYO_NIGHT.comment))
    .child(keycap("1-4", view.hasKeyboard)).child(text("host", TOKYO_NIGHT.comment))
    .when(Boolean(view.shortcut), (element) => element.child(keycap(view.shortcut, true)).child(text("toggle", TOKYO_NIGHT.comment)))
    .child(div().flex_1().min_w(0).truncate().text_right().text_color(view.hasKeyboard ? TOKYO_NIGHT.blue : TOKYO_NIGHT.comment).child(keysHint));
}

/* ---------- overview ---------- */

/**
 * Puts the samples at the right end of a chart that is always the chosen range wide, so new data grows from the right.
 * @param {(number | null)[]} samples
 * @param {number} rangeSamples
 */
const padToRange = (samples, rangeSamples) => [...Array(Math.max(0, rangeSamples - samples.length)).fill(null), ...samples];

/** @param {ConsoleView} view @param {HostSnapshot} host */
function chartMarkers(view, host) {
  const times = (view.history.hosts[host.label]?.at ?? []).slice(-view.rangeSamples);
  if (times.length < 2) return [];
  const missingSamples = view.rangeSamples - times.length;
  const lastIndex = view.rangeSamples - 1;
  const start = times[0], end = times[times.length - 1];
  return (view.history.events[host.label] ?? []).filter((event) => event.at >= start && event.at <= end)
    .map((event) => {
      const sampleIndex = missingSamples + ((event.at - start) / (end - start)) * (times.length - 1);
      return { position: sampleIndex / lastIndex, color: EVENT_COLORS[event.kind], text: event.text };
    });
}

/** @param {string} label @param {string} value @param {Color} valueColor @param {Element} chart */
const chartBlock = (label, value, valueColor, chart) => v_flex().flex_1().min_w(0).gap(4)
  .child(h_flex().justify_between().child(text(label, TOKYO_NIGHT.comment)).child(text(value, valueColor).font_semibold()))
  .child(chart);

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function hostCharts(view, host, settings) {
  const series = view.history.hosts[host.label];
  /** @param {(number | null)[] | undefined} samples */
  const lastSamples = (samples) => padToRange((samples ?? []).slice(-view.rangeSamples), view.rangeSamples);
  const cpuChart = areaChart({ samples: lastSamples(series?.cpu), heightPx: CHART_HEIGHT_PX, gradient: GRADIENTS.cpu, markers: chartMarkers(view, host) });
  const memChart = areaChart({ samples: lastSamples(series?.mem), heightPx: CHART_HEIGHT_PX, gradient: GRADIENTS.memory, secondLine: lastSamples(series?.swap), secondLineColor: TOKYO_NIGHT.purple });
  return h_flex().gap(10)
    .child(chartBlock(`cpu · ${host.ncpu ?? "?"} cores`, percentText(host.cpu_pct), levelColor(level(host.cpu_pct, settings)), cpuChart))
    .child(chartBlock(`mem ${kibAsGib(host.mem_used_kb)} / ${kibAsGib(host.mem_total_kb)} GiB`, percentText(host.mem_pct), levelColor(level(host.mem_pct, settings)), memChart));
}

/** @param {HostSnapshot} host */
function diskDetail(host) {
  const free = Number.isFinite(host.disk_total_kb) && Number.isFinite(host.disk_used_kb) ? storageSize(host.disk_total_kb - host.disk_used_kb) : "?";
  if (Number.isFinite(host.disk_read_rate) || Number.isFinite(host.disk_write_rate)) return `${free} free · r ${byteRate(host.disk_read_rate)} w ${byteRate(host.disk_write_rate)}`;
  if (Number.isFinite(host.disk_io_rate)) return `${free} free · io ${byteRate(host.disk_io_rate)}`;
  return `${free} free`;
}

/** @param {ConsoleView} view */
function worktreeLine(view) {
  const worktrees = worktreesOf(view);
  if (!worktrees || worktrees.state === "pending") return "measuring worktrees…";
  const staleCount = worktrees.items.filter((worktree) => isStaleWorktree(worktree, view.agents)).length;
  return `${storageSize(worktrees.total_kb)} in ${worktrees.items.length} worktrees · ${staleCount} stale`;
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function hostRows(view, host, settings) {
  const isWide = view.width >= WIDE_PANE_PX;
  const series = view.history.hosts[host.label];
  const rx = (series?.rx ?? []).slice(-40), tx = (series?.tx ?? []).slice(-40);
  const netMaximum = Math.max(1, ...rx.map((value) => value ?? 0), ...tx.map((value) => value ?? 0));
  const rows = v_flex().gap(5);
  if (host.cores.length) rows.child(h_flex().gap(10).items_center().child(rowLabel("cores")).child(coreStrip(host.cores, host.cores.length > MANY_CORES || !isWide ? NARROW_CORE_CELL_PX : WIDE_CORE_CELL_PX)));
  rows.child(h_flex().gap(10).items_center().child(rowLabel("disk")).child(meter(host.disk_pct, DISK_METER_CELLS, GRADIENTS.disk))
    .child(rightCell(percentText(host.disk_pct), PERCENT_WIDTH_PX, levelColor(level(host.disk_pct, settings))))
    .child(div().min_w(0).truncate().text_color(TOKYO_NIGHT.dim).child(diskDetail(host))));
  rows.child(h_flex().gap(10).items_center().child(rowLabel("net"))
    .child(sparkline(rx, TOKYO_NIGHT.teal, NET_SPARKLINE_WIDTH_PX, NET_SPARKLINE_HEIGHT_PX, netMaximum))
    .child(sparkline(tx, TOKYO_NIGHT.cyan, NET_SPARKLINE_WIDTH_PX, NET_SPARKLINE_HEIGHT_PX, netMaximum))
    .child(div().min_w(0).truncate().text_color(TOKYO_NIGHT.dim).child(`↓ ${byteRate(host.net_rx_rate)} ↑ ${byteRate(host.net_tx_rate)}`)));
  if (host.gpu) {
    const vram = `${((host.gpu.mem_used_mib ?? 0) / 1024).toFixed(1)} / ${((host.gpu.mem_total_mib ?? 0) / 1024).toFixed(1)} GiB`;
    rows.child(h_flex().gap(10).items_center().child(rowLabel("gpu")).child(meter(host.gpu.pct, DISK_METER_CELLS, GRADIENTS.swap))
      .child(rightCell(percentText(host.gpu.pct), PERCENT_WIDTH_PX, levelColor(level(host.gpu.pct, settings))))
      .child(div().min_w(0).truncate().text_color(TOKYO_NIGHT.dim).child(`${host.gpu.name} · vram ${vram}`)));
  }
  rows.child(h_flex().gap(10).items_center().child(rowLabel("wt")).child(div().min_w(0).truncate().text_color(TOKYO_NIGHT.teal).child(worktreeLine(view))));
  return rows;
}

/** @param {HostSnapshot} host @param {number} index @param {Color} color */
const hostTitle = (host, index, color) => titleRow(text(superscript(index + 1), TOKYO_NIGHT.comment), text(host.label, color).font_semibold());

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function systemPanel(view, host, settings) {
  const index = view.monitorState?.snapshot?.hosts.indexOf(host) ?? 0;
  const stale = isStale(host, settings);
  const right = `${host.os} · up ${Number.isFinite(host.uptime_seconds) ? age(host.uptime_seconds) : "?"}${stale ? ` · stale ${ageSince(host.updated_at)}` : ""}`;
  return panel({
    id: `system-${host.label}`,
    title: hostTitle(host, index, TOKYO_NIGHT.blue),
    rightTitle: text(right, stale ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.comment),
    body: [hostCharts(view, host, settings), hostRows(view, host, settings)],
  });
}

/* ---------- agents ---------- */

/** @param {AgentState} state */
function stateCell(state) {
  const look = AGENT_STATES[state];
  return h_flex().w(96).flex_none().gap(5).items_center().child(div().size(7).rounded(4).bg(look.color)).child(text(look.label, state === "blocked" ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.foregroundDark));
}

/** @param {AgentView} agent @param {HostSnapshot} host @param {MonitorSettings} settings @param {boolean} isWide */
function agentRow(agent, host, settings, isWide) {
  const { process } = agent;
  const cpu = process.cpu ?? 0;
  const peak = Math.max(PERCENT_SCALE, ...agent.cpuHistory.map((value) => value ?? 0));
  const branch = process.branch || homeRelative(process.cwd, host.home);
  return h_flex().gap(8).items_center().h(24).id(`agent-${host.label}-${process.pid}`).tooltip(homeRelative(process.cwd, host.home))
    .child(div().w(84).flex_none().child(chip(process.app, toolColor(process.app))))
    .child(stateCell(agent.state))
    .child(h_flex().flex_1().min_w(0).gap(6).child(text(process.repository || "", TOKYO_NIGHT.blue)).child(div().min_w(0).truncate().text_color(TOKYO_NIGHT.foregroundDark).child(branch)))
    .when(isWide, (element) => element.child(sparkline(padToRange(agent.cpuHistory, AGENT_HISTORY_SLOTS), gradientAt(GRADIENTS.cpu, gradientPosition(cpu)), AGENT_SPARKLINE_WIDTH_PX, AGENT_SPARKLINE_HEIGHT_PX, peak)))
    .child(rightCell(cpu.toFixed(1), 54, levelColor(level(Math.min(cpu, PERCENT_SCALE), settings))))
    .child(rightCell(Number.isFinite(process.elapsed_seconds) ? age(process.elapsed_seconds) : "?", 46, TOKYO_NIGHT.comment));
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function agentsPanel(view, host, settings) {
  const working = view.agents.filter((agent) => agent.state === "working").length;
  const isWide = view.width >= WIDE_PANE_PX;
  const tableHeader = h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(div().w(84).flex_none().child("agent")).child(div().w(96).flex_none().child("state")).child(div().flex_1().child("branch"))
    .when(isWide, (element) => element.child(div().w(AGENT_SPARKLINE_WIDTH_PX).flex_none().child("cpu 2.5m"))).child(rightCell("cpu", 54, TOKYO_NIGHT.comment)).child(rightCell("up", 46, TOKYO_NIGHT.comment));
  const body = view.agents.length
    ? [v_flex().gap(2).child(tableHeader).children(view.agents.map((agent) => agentRow(agent, host, settings, isWide)))]
    : [text("No coding agents are running on this host.", TOKYO_NIGHT.comment)];
  return panel({ id: `agents-${host.label}`, title: text("agents", TOKYO_NIGHT.magenta).font_semibold(), rightTitle: text(`${working} working`, TOKYO_NIGHT.comment), body });
}

/* ---------- ports ---------- */

/** @param {AgentView[]} agents @param {number | null} pid */
const agentProcessWithPid = (agents, pid) => agents.find(({ process }) => process.pid === pid)?.process ?? null;

/** @param {ConsoleView} view @param {HostSnapshot} host */
function portsPanel(view, host) {
  const rows = [...host.ports].sort((first, second) => Number(Boolean(second.agent_pid)) - Number(Boolean(first.agent_pid)) || first.port - second.port);
  const tableHeader = h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(rightCell("port", 64, TOKYO_NIGHT.comment)).child(div().w(150).flex_none().child("process")).child(div().w(96).flex_none().child("agent")).child(div().flex_1().child("worktree"));
  const portRows = rows.map((port) => {
    const owner = agentProcessWithPid(view.agents, port.agent_pid);
    return h_flex().gap(8).items_center().h(22)
      .child(rightCell(`:${port.port}`, 64, TOKYO_NIGHT.cyan))
      .child(div().w(150).flex_none().truncate().text_color(port.process ? TOKYO_NIGHT.foregroundDark : TOKYO_NIGHT.comment).child(port.process || "other user"))
      .child(div().w(96).flex_none().child(owner ? chip(owner.app, toolColor(owner.app)) : text("system", TOKYO_NIGHT.comment)))
      .child(div().flex_1().min_w(0).truncate().text_color(TOKYO_NIGHT.comment).child(owner ? homeRelative(owner.cwd, host.home) : ""));
  });
  const body = rows.length ? [v_flex().gap(2).child(tableHeader).children(portRows)] : [text("No listening TCP ports, or the host does not show them to this user.", TOKYO_NIGHT.comment)];
  return panel({ id: `ports-${host.label}`, title: text("ports", TOKYO_NIGHT.cyan).font_semibold(), rightTitle: text("listening", TOKYO_NIGHT.comment), body });
}

/* ---------- worktrees ---------- */

/** @param {WorktreeItem} worktree @param {number} largestKib @param {ConsoleView} view */
function worktreeRow(worktree, largestKib, view) {
  const share = largestKib > 0 ? ((worktree.size_kb ?? 0) / largestKib) * PERCENT_SCALE : 0;
  const days = daysSince(worktree.last_commit_at);
  const stale = isStaleWorktree(worktree, view.agents);
  const agentHere = hasAgentIn(worktree, view.agents);
  const changed = worktree.changed_files ?? 0;
  return h_flex().id(`wt-${worktree.absolute_path}`).w_full().h(WORKTREE_ROW_HEIGHT_PX).px(8).gap(8).items_center().border_b(1).border_color(TOKYO_NIGHT.highlight)
    .tooltip(`${worktree.path} · ↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}`)
    .child(rightCell(storageSize(worktree.size_kb), 64, gradientAt(GRADIENTS.storage, share / PERCENT_SCALE)))
    .when(view.width >= WIDE_PANE_PX, (element) => element.child(meter(share, WORKTREE_METER_CELLS, GRADIENTS.storage)))
    .child(div().w(78).flex_none().child(chip(worktree.tool, toolColor(worktree.tool))))
    .child(div().w(view.width >= WIDE_PANE_PX ? 110 : 80).flex_none().truncate().text_color(TOKYO_NIGHT.blue).child(worktree.repository))
    .child(h_flex().flex_1().min_w(0).gap(4).when(agentHere, (element) => element.child(text(AGENT_MARKER, TOKYO_NIGHT.green))).child(div().min_w(0).truncate().text_color(TOKYO_NIGHT.foreground).child(worktree.branch)))
    .child(rightCell(changed > 0 ? `±${changed}` : "clean", 52, changed > 0 ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.comment))
    .child(rightCell(days === null ? "?" : `${days}d`, 40, stale ? TOKYO_NIGHT.orange : TOKYO_NIGHT.comment));
}

/** @param {ConsoleView} view @param {HostSnapshot} host */
function worktreesPanel(view, host) {
  const worktrees = worktreesOf(view);
  if (!worktrees || (worktrees.state === "pending" && !worktrees.items.length)) {
    return panel({ id: `worktrees-${host.label}`, title: text("worktrees", TOKYO_NIGHT.teal).font_semibold(), body: [text("Measuring worktrees. This takes up to a minute and runs every 5 minutes.", TOKYO_NIGHT.comment)] });
  }
  const filter = WORKTREE_FILTERS[view.worktreeFilter];
  const rows = worktrees.items.filter((worktree) => filter.test(worktree, view.agents));
  const largestKib = worktrees.items.reduce((largest, worktree) => Math.max(largest, worktree.size_kb ?? 0), 0);
  const staleItems = worktrees.items.filter((worktree) => isStaleWorktree(worktree, view.agents));
  const reclaimableKib = staleItems.reduce((sum, worktree) => sum + (worktree.size_kb ?? 0), 0);
  const options = /** @type {WorktreeFilter[]} */ (Object.keys(WORKTREE_FILTERS)).map((value) => ({
    value, label: WORKTREE_FILTERS[value].label, tooltip: WORKTREE_FILTERS[value].tooltip,
    count: worktrees.items.filter((worktree) => WORKTREE_FILTERS[value].test(worktree, view.agents)).length,
  }));
  const list = rows.length
    ? div().flex_1().min_h(0).rounded(6).border_1().border_color(TOKYO_NIGHT.highlight).bg(TOKYO_NIGHT.backgroundDark).overflow_hidden()
      .child(uniform_list(`worktrees-${host.label}-${view.worktreeFilter}`, rows.length, (index) => rows[index].absolute_path,
        (range) => rows.slice(range.start, range.end).map((worktree) => worktreeRow(worktree, largestKib, view))).size_full())
    : div().p(10).text_color(TOKYO_NIGHT.comment).child("No worktree matches this filter.");
  const body = [
    h_flex().gap(8).flex_wrap().justify_between().items_center()
      .child(filterChips({ id: `worktree-filters-${host.label}`, options, selected: view.worktreeFilter, onSelect: view.onWorktreeFilter }))
      .child(titleRow(text("reclaimable from stale:", TOKYO_NIGHT.comment), text(storageSize(reclaimableKib), TOKYO_NIGHT.orange))),
    list,
    text(`${rows.length} of ${worktrees.items.length} worktrees · measured ${ageSince(worktrees.measured_at)} · every 5 min`, TOKYO_NIGHT.comment).text_size(10.5),
  ];
  if (worktrees.state === "failed") body.unshift(text(`Last measure failed: ${worktrees.error}`, TOKYO_NIGHT.red));
  return panel({
    id: `worktrees-${host.label}`,
    title: titleRow(text("worktrees", TOKYO_NIGHT.teal).font_semibold(), text(storageSize(worktrees.total_kb), TOKYO_NIGHT.foreground)),
    rightTitle: text(ageSince(worktrees.measured_at), TOKYO_NIGHT.comment),
    body,
    fill: true,
  });
}

/* ---------- processes ---------- */

/** @param {ProcessRow} process @param {ProcessSort} sort */
const processSortValue = (process, sort) => (sort === "mem" ? process.mem : process.cpu) ?? 0;

/** @param {string} label @param {ProcessSort} sortKey @param {ConsoleView} view */
function sortableHeader(label, sortKey, view) {
  const isActive = view.sort === sortKey;
  return h_flex().id(`column-${sortKey}`).w(62).flex_none().justify_end().px(4).rounded(3).cursor_pointer()
    .tooltip(`Sort by ${sortKey === "cpu" ? "CPU (c)" : "memory (m)"}`)
    .text_color(isActive ? TOKYO_NIGHT.blue : TOKYO_NIGHT.comment)
    .hover((style) => style.bg(TOKYO_NIGHT.highlight).text_color(TOKYO_NIGHT.foreground))
    .active((style) => style.bg(TOKYO_NIGHT.border))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      view.onSort(sortKey);
    })
    .child(isActive ? `${label} ${SORT_MARKER}` : label);
}

/** @param {ConsoleView} view @param {HostSnapshot} host @param {MonitorSettings} settings */
function processesPanel(view, host, settings) {
  const isWide = view.width >= WIDE_PANE_PX;
  const rows = [...host.processes].sort((first, second) => processSortValue(second, view.sort) - processSortValue(first, view.sort)).slice(0, settings.top_n);
  const tableHeader = h_flex().gap(8).text_color(TOKYO_NIGHT.comment)
    .child(div().w(14).flex_none()).child(rightCell("pid", 64, TOKYO_NIGHT.comment)).child(div().flex_1().child("program"))
    .when(isWide, (element) => element.child(div().w(PROCESS_METER_CELLS * METER_CELL_STEP_PX).flex_none()))
    .child(sortableHeader("cpu%", "cpu", view)).child(sortableHeader("mem%", "mem", view));
  const processRows = rows.map((process) => {
    const cpu = process.cpu ?? 0, mem = process.mem ?? 0;
    return h_flex().gap(8).items_center().h(20)
      .child(div().w(14).flex_none().text_color(TOKYO_NIGHT.green).child(process.agent ? AGENT_MARKER : ""))
      .child(rightCell(String(process.pid ?? "?"), 64, TOKYO_NIGHT.comment))
      .child(div().flex_1().min_w(0).truncate().text_color(process.agent ? TOKYO_NIGHT.foreground : TOKYO_NIGHT.foregroundDark).child(process.name))
      .when(isWide, (element) => element.child(meter(Math.min(cpu, PERCENT_SCALE), PROCESS_METER_CELLS, GRADIENTS.cpu)))
      .child(rightCell(cpu.toFixed(1), 62, levelColor(level(Math.floor(cpu), settings), gradientAt(GRADIENTS.cpu, gradientPosition(cpu)))))
      .child(rightCell(mem.toFixed(1), 62, gradientAt(GRADIENTS.memory, gradientPosition(mem * 4))));
  });
  return [
    h_flex().justify_end().gap(8).items_center().child(text("sort", TOKYO_NIGHT.comment))
      .child(segmentedControl({ id: "sort", options: SORT_OPTIONS, selected: view.sort, onSelect: view.onSort })),
    panel({
      id: `procs-${host.label}`,
      title: titleRow(text("procs", TOKYO_NIGHT.magenta).font_semibold(), text(`top ${rows.length}`, TOKYO_NIGHT.comment)),
      rightTitle: text(`by ${view.sort === "mem" ? "memory" : "cpu"}`, TOKYO_NIGHT.comment),
      body: [v_flex().max_w(PROCESS_TABLE_MAX_WIDTH_PX).gap(2).child(tableHeader).children(processRows)],
    }),
  ];
}

/* ---------- states ---------- */

/** @param {HostSnapshot} host @param {number} index */
function unreachablePanel(host, index) {
  const color = host.state === "auth" ? TOKYO_NIGHT.yellow : TOKYO_NIGHT.red;
  return panel({
    id: `state-${host.label}`,
    title: hostTitle(host, index, color),
    rightTitle: text(host.state === "auth" ? "login needed" : "down", color),
    borderColor: color,
    body: [
      text(`✕ ${host.state === "auth" ? "login refused" : "no answer"} · values below are from ${ageSince(host.updated_at)}`, color),
      div().text_color(TOKYO_NIGHT.comment).child(host.error || "no error text"),
    ],
  });
}

/** @param {ConsoleView} view */
function notice(view) {
  const snapshot = view.monitorState?.snapshot;
  if (view.monitorState?.error) return { color: TOKYO_NIGHT.red, message: `Backend error: ${view.monitorState.error}` };
  if (!snapshot) return { color: TOKYO_NIGHT.yellow, message: "Waiting for the first poll of your hosts." };
  if (!snapshot.hosts.length) return { color: TOKYO_NIGHT.dim, message: `No hosts. Add "label  ssh-target" lines to ${snapshot.hosts_file}` };
  if (nowInSeconds() - snapshot.generated_at > snapshot.settings.stale_seconds) {
    return { color: TOKYO_NIGHT.yellow, message: `No fresh data since ${ageSince(snapshot.generated_at)}. The next poll is late.` };
  }
  return null;
}

/** @param {ConsoleView} view @returns {Element[]} */
function tabBody(view) {
  const snapshot = view.monitorState?.snapshot;
  const host = view.host;
  if (!snapshot || !host) return [];
  const settings = snapshot.settings;
  const index = snapshot.hosts.indexOf(host);
  if (host.state === "pending") return [panel({ id: `state-${host.label}`, title: hostTitle(host, index, TOKYO_NIGHT.blue), body: [text("… waiting for the first poll", TOKYO_NIGHT.comment)] })];
  const prefix = host.state === "ok" ? [] : [unreachablePanel(host, index)];
  if (view.tab === "agents") return [...prefix, agentsPanel(view, host, settings)];
  if (view.tab === "ports") return [...prefix, portsPanel(view, host)];
  if (view.tab === "worktrees") return [...prefix, worktreesPanel(view, host)];
  if (view.tab === "procs") return [...prefix, ...processesPanel(view, host, settings)];
  return [...prefix, systemPanel(view, host, settings), agentsPanel(view, host, settings)];
}

/**
 * The tabbed console: host tabs and range in the header, a tab strip, one tab body, and the key footer.
 * @param {ConsoleView} view
 * @param {string} monospaceFont
 */
export function renderConsole(view, monospaceFont) {
  const banner = notice(view);
  return v_flex().id("herdwatch-console").size_full().bg(TOKYO_NIGHT.background).font_family(monospaceFont).text_size(12).text_color(TOKYO_NIGHT.foreground)
    .child(header(view))
    .child(consoleTabs(view))
    .child(v_flex().id(`console-body-${view.tab}`).flex_1().min_h(0).px(10).pt(8).pb(12).gap(12)
      .when(view.tab !== "worktrees", (element) => element.overflow_y_scrollbar())
      .when(Boolean(banner), (element) => element.child(panel({
        id: "herdwatch-notice", title: text("notice", banner.color), borderColor: banner.color, body: [div().text_color(banner.color).child(banner.message)],
      })))
      .children(tabBody(view)))
    .child(footer(view));
}

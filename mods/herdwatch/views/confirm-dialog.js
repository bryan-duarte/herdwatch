import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { TOKYO_NIGHT } from "../palette.js";
import { checkbox, text, textButton, titleRow, uiIcon } from "./widgets.js";

/** @typedef {import("../schemas.js").DialogView} DialogView */
/** @typedef {import("../schemas.js").PendingAction} PendingAction */

const DIALOG_TEXT_SIZE_PX = 12;
const TITLE_TEXT_SIZE_PX = 14;
const FAILURE_DETAIL_TEXT_SIZE_PX = 11;
const RUNNING_LABEL = "Working…";

/** @param {string} warning @param {number} index */
const warningLine = (warning, index) => h_flex().id(`dialog-warning-${index}`).gap(6).items_start().text_color(TOKYO_NIGHT.yellow)
  .child(uiIcon("triangle-alert").mt(2)).child(div().flex_1().min_w(0).child(warning));

/** @param {DialogView} view @param {PendingAction} pending */
function confirmLabel(view, pending) {
  if (view.state.isRunning) return RUNNING_LABEL;
  if (view.state.isEscalated && pending.escalation) return pending.escalation.confirmLabel;
  return pending.confirmLabel;
}

/** @param {DialogView} view @param {PendingAction} pending */
function buttonRow(view, pending) {
  const { isRunning, isFinished } = view.state;
  const cancel = textButton({ id: "dialog-cancel", label: isFinished ? "Close" : "Cancel", tooltip: "Close without a change (Esc)", onPress: view.onCancel });
  const row = h_flex().gap(8).justify_end().pt(4).child(cancel);
  if (isFinished) return row;
  return row.child(textButton({
    id: "dialog-confirm",
    label: confirmLabel(view, pending),
    tooltip: "Run it (Enter)",
    isPrimary: true,
    isDestructive: pending.isDestructive,
    isDisabled: isRunning,
    onPress: view.onConfirm,
  }));
}

/** @param {DialogView} view */
function failureBlock(view) {
  const { failure } = view.state;
  if (!failure) return [];
  return [v_flex().gap(2).p(8).rounded(6).border_1().border_color(TOKYO_NIGHT.red)
    .child(div().text_color(TOKYO_NIGHT.red).child(failure.message))
    .when(Boolean(failure.detail), (element) => element.child(div().text_color(TOKYO_NIGHT.comment).text_size(FAILURE_DETAIL_TEXT_SIZE_PX).child(failure.detail)))];
}

/** @param {DialogView} view */
function staleDialog(view) {
  return [
    text("This dialog is out of date.", TOKYO_NIGHT.yellow),
    h_flex().justify_end().child(textButton({ id: "dialog-cancel", label: "Close", tooltip: "Close (Esc)", onPress: view.onCancel })),
  ];
}

/** @param {DialogView} view @param {PendingAction} pending */
function dialogBody(view, pending) {
  const options = pending.options.map((option) => checkbox({
    id: `dialog-option-${option.key}`,
    label: option.label,
    isChecked: Boolean(view.state.checked[option.key]),
    onToggle: (cx) => view.onToggleOption(option.key, cx),
  }));
  return [
    titleRow(text(pending.title, pending.isDestructive ? TOKYO_NIGHT.red : TOKYO_NIGHT.foreground).font_semibold().text_size(TITLE_TEXT_SIZE_PX)),
    v_flex().gap(2).children(pending.details.map((detail) => div().text_color(TOKYO_NIGHT.foregroundDark).child(detail))),
    ...pending.warnings.map(warningLine),
    ...options,
    ...failureBlock(view),
    buttonRow(view, pending),
  ];
}

/**
 * @param {DialogView} view
 * @param {string} monospaceFont
 */
export function renderConfirmDialog(view, monospaceFont) {
  return v_flex().id("herdwatch-dialog").w_full().p(16).gap(10).bg(TOKYO_NIGHT.background)
    .font_family(monospaceFont).text_size(DIALOG_TEXT_SIZE_PX).text_color(TOKYO_NIGHT.foreground)
    .children(view.pending ? dialogBody(view, view.pending) : staleDialog(view));
}

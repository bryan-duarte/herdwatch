import { setShared, shared } from "herdr";
import { nowInSeconds } from "./format.js";
import { isRecord } from "./snapshot.js";

/** @typedef {import("./schemas.js").PendingAction} PendingAction */

const PENDING_KEY = "herdwatch.pending";
const BLOCKING_SECONDS = 600;
const ID_RADIX = 36;
const ZERO_POINT_PREFIX_LENGTH = 2;

const newPendingId = () => `${Date.now()}-${Math.random().toString(ID_RADIX).slice(ZERO_POINT_PREFIX_LENGTH)}`;

/** @param {unknown} stored @returns {PendingAction | null} */
function pendingOrNull(stored) {
  const isPending = isRecord(stored) && typeof stored.id === "string" && typeof stored.name === "string" && Array.isArray(stored.args);
  return isPending ? /** @type {PendingAction} */ (stored) : null;
}

/**
 * A dialog that closed without clean-up (Herdr quit) stops blocking new dialogs after BLOCKING_SECONDS.
 * @param {PendingAction | null} pending
 */
const isBlocking = (pending) => Boolean(pending) && nowInSeconds() - pending.createdAt < BLOCKING_SECONDS;

/**
 * @param {Omit<PendingAction, "id" | "createdAt">} action
 * @returns {PendingAction | null} null when another dialog is open
 */
export function storePendingAction(action) {
  if (isBlocking(pendingOrNull(shared(PENDING_KEY)))) return null;
  const pending = { ...action, id: newPendingId(), createdAt: nowInSeconds() };
  setShared(PENDING_KEY, pending);
  return pending;
}

/**
 * The pending action, only when it is still the one this dialog opened for, so a stale dialog never runs a newer action.
 * @param {string} id
 * @returns {PendingAction | null}
 */
export function readPendingAction(id) {
  const pending = pendingOrNull(shared(PENDING_KEY));
  return pending?.id === id ? pending : null;
}

/** @param {string} id */
export function clearPendingAction(id) {
  if (readPendingAction(id)) setShared(PENDING_KEY, null);
}

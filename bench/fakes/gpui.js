/**
 * A counting stand-in for "gpui-kit" and "gpui-base": every element made, every chained call and every path
 * operation adds to `counters`, so a render in Node tells how much it asks of the host.
 */
export const counters = { elements: 0, calls: 0, pathOps: 0, paints: 0 };

export function resetCounters() {
  Object.assign(counters, { elements: 0, calls: 0, pathOps: 0, paints: 0 });
}

/** @param {any} element @param {string | symbol} name @param {any[]} args */
function elementCall(element, name, args) {
  counters.calls++;
  if (name === "when") return args[0] ? args[1](element) : element;
  if (name === "map") return args[0](element);
  if (name === "children") Array.from(args[0]);
  return element;
}

const elementTraps = {
  /** @param {any} _target @param {string | symbol} name @param {any} element */
  get(_target, name, element) {
    if (name === "then") return undefined;
    return (/** @type {any[]} */ ...args) => elementCall(element, name, args);
  },
};

function element() {
  counters.elements++;
  return new Proxy(() => {}, elementTraps);
}

const pathTraps = {
  /** @param {any} _target @param {string | symbol} name @param {any} builder */
  get(_target, name, builder) {
    return () => {
      counters.calls++;
      counters.pathOps++;
      return name === "build" ? {} : builder;
    };
  },
};

const pathBuilder = () => new Proxy({}, pathTraps);

const backgroundTraps = {
  get: () => () => {
    counters.calls++;
    return background();
  },
};

function background() {
  return new Proxy({}, backgroundTraps);
}

export const div = element;
export const svg = element;
export const image = element;
export const h_flex = element;
export const v_flex = element;
export class View {}
export const PathBuilder = { fill: pathBuilder, stroke: pathBuilder };
export const Background = { linear_gradient: background, stop: () => ({}), solid: background };

globalThis.window = {
  paint_path: () => {
    counters.calls++;
    counters.paints++;
    return element();
  },
};

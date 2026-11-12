/**
 * An in-memory stand-in for Herdr.app's "herdr" module. Tests set the fields of fakeHerdr, then read what the mod wrote.
 */
export const fakeHerdr = {
  sharedState: new Map(),
  agents: [],
  panes: [],
  spaces: [],
  keys: [],
  focused: null,
  props: null,
  platform: "macos",
  execCalls: [],
  execHandler: async () => ({ code: 0, stdout: "", stderr: "" }),
  notifications: [],
  sounds: [],
  commands: [],
};

export function resetFakeHerdr() {
  fakeHerdr.sharedState = new Map();
  fakeHerdr.agents = [];
  fakeHerdr.panes = [];
  fakeHerdr.spaces = [];
  fakeHerdr.keys = [];
  fakeHerdr.focused = null;
  fakeHerdr.props = null;
  fakeHerdr.platform = "macos";
  fakeHerdr.execCalls = [];
  fakeHerdr.execHandler = async () => ({ code: 0, stdout: "", stderr: "" });
  fakeHerdr.notifications = [];
  fakeHerdr.sounds = [];
  fakeHerdr.commands = [];
}

export const shared = (key) => structuredClone(fakeHerdr.sharedState.get(key));

export function setShared(key, value) {
  fakeHerdr.sharedState.set(key, structuredClone(value));
  return null;
}

export async function exec(command, args, options) {
  fakeHerdr.execCalls.push({ command, args, options });
  return fakeHerdr.execHandler(command, args, options);
}

export const appHome = () => "/home/dev/.config/herdr-app";
export const agents = () => fakeHerdr.agents;
export const panes = () => fakeHerdr.panes;
export const spaces = () => fakeHerdr.spaces;
export const keys = () => fakeHerdr.keys;
export const focused = () => fakeHerdr.focused;
export const props = () => fakeHerdr.props;
export const window = () => ({ platform: fakeHerdr.platform });
export const theme = () => ({});

export function run(name, args) {
  fakeHerdr.commands.push({ name, args });
  return null;
}

export function notify(notification) {
  fakeHerdr.notifications.push(notification);
  return null;
}

export function playSound(sound) {
  fakeHerdr.sounds.push(sound);
  return null;
}

export const nextCommand = () => new Promise(() => {});

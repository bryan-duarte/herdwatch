const GPUI_FAKE = new URL("../bench/fakes/gpui.js", import.meta.url).href;
const FAKE_MODULES = {
  herdr: new URL("./fakes/herdr.js", import.meta.url).href,
  "gpui-kit": GPUI_FAKE,
  "gpui-base": GPUI_FAKE,
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(FAKE_MODULES, specifier)) return { url: FAKE_MODULES[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}

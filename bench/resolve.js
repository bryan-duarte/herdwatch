const FAKE_MODULES = {
  herdr: new URL("../tests/fakes/herdr.js", import.meta.url).href,
  "gpui-kit": new URL("./fakes/gpui.js", import.meta.url).href,
  "gpui-base": new URL("./fakes/gpui.js", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(FAKE_MODULES, specifier)) return { url: FAKE_MODULES[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}

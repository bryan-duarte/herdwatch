import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RUNS_PER_CASE = 7;
/** A tab case draws the console frame and the body of that tab (a first visit); "frame" draws the frame only (a click on a tab whose body is current). A mod without tab bodies draws its whole console in each case. */
export const ENGINE_CASES = ["overview:60", "overview:120", "agents:60", "ports:60", "worktrees:60", "docker:60", "procs:60", "frame:60", "pill:60", "poll:60"];
const RESULT_PATTERN = /QBENCH (\{.*\})/;
const STOPPED_BY_ENGINE = /^interrupted/m;
const CASE_TEMPLATE = readFileSync(new URL("./engine/case.js", import.meta.url), "utf8");

/** Its own Herdr home, so a bench run never reads or writes the shared state of the real app. */
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "herdwatch-bench-home-"));

/** @param {string} folder */
export const removeFolder = (folder) => rmSync(folder, { recursive: true, force: true });

process.on("exit", () => removeFolder(ISOLATED_HOME));

/** @param {string} spec "overview:60" */
export function parseCase(spec) {
  const [caseName, range] = spec.split(":");
  return { caseName, range: Number(range), key: `${caseName}-${range}` };
}

/**
 * Copies the mod's JS into a throwaway mod whose main.js times one case.
 * @param {string} modDir @param {{ backendOutput: string, history: object }} fixture @param {string} spec
 */
export function caseFolder(modDir, fixture, spec) {
  const { caseName, range } = parseCase(spec);
  const folder = mkdtempSync(join(tmpdir(), `herdwatch-bench-${caseName}-`));
  readdirSync(modDir).filter((name) => name.endsWith(".js")).forEach((name) => cpSync(join(modDir, name), join(folder, name)));
  cpSync(join(modDir, "views"), join(folder, "views"), { recursive: true });
  cpSync(join(folder, "main.js"), join(folder, "herdwatch-main.js"));
  writeFileSync(join(folder, "mod.json"), '{ "place": "none" }');
  writeFileSync(join(folder, "bench-data.js"), `export const RAW = ${JSON.stringify(fixture.backendOutput)};\nexport const HISTORY = ${JSON.stringify(fixture.history)};\n`);
  writeFileSync(join(folder, "main.js"), CASE_TEMPLATE.replaceAll("__CASE__", caseName).replaceAll("__RANGE__", String(range)));
  return folder;
}

/**
 * One `herdr-app check` run: the render time in ms, or null when the engine stopped the render.
 * @param {string} folder
 */
export function runOnce(folder) {
  try {
    execFileSync("herdr-app", ["check", folder], { encoding: "utf8", stdio: "pipe", env: { ...process.env, HERDR_APP_HOME: ISOLATED_HOME } });
  } catch (checkError) {
    const output = `${checkError.stdout ?? ""}${checkError.stderr ?? ""}`;
    const match = output.match(RESULT_PATTERN);
    if (match) return JSON.parse(match[1]).ms;
    if (STOPPED_BY_ENGINE.test(output)) return null;
    throw new Error(`bench case in ${folder} failed:\n${output}`);
  }
  throw new Error(`bench case in ${folder} passed the check, so it did not time a render`);
}

/** @param {number[]} values */
export const median = (values) => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)];

/** @param {(number | null)[]} times */
export function summarize(times) {
  const finished = times.filter((time) => time !== null);
  return { medianMs: finished.length ? Number(median(finished).toFixed(1)) : null, overLimit: times.length - finished.length };
}

/** @param {string} modDir @param {{ backendOutput: string, history: object }} fixture */
export function measureEngine(modDir, fixture) {
  return Object.fromEntries(ENGINE_CASES.map((spec) => {
    const folder = caseFolder(modDir, fixture, spec);
    try {
      const times = Array.from({ length: RUNS_PER_CASE }, () => runOnce(folder));
      return [parseCase(spec).key, summarize(times)];
    } finally {
      removeFolder(folder);
    }
  }));
}

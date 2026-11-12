/**
 * npm run bench                       this mod against bench/baseline.json
 * npm run bench:save                  writes this mod's numbers to bench/baseline.json
 * npm run bench -- --against <ref>    A/B: the mod of a git ref and this mod, run in turns
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_CASES, caseFolder, measureEngine, parseCase, removeFolder, runOnce, summarize } from "./engine.js";
import { buildFixture } from "./fixture.js";
import { measureStructure } from "./structure.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOD_DIR = join(REPOSITORY_ROOT, "mods/herdwatch");
const BASELINE_PATH = join(REPOSITORY_ROOT, "bench/baseline.json");
const AB_RUNS_PER_SIDE = 11;
const GIT_ARCHIVE_MAX_BYTES = 1 << 28;
const PERCENT_SCALE = 100;
const COLUMN_WIDTHS = [16, 12, 12, 9];

/** @param {number | null} base @param {number | null} now */
function changeText(base, now) {
  if (base === null || now === null) return "—";
  if (base === 0) return now === 0 ? "0%" : "new";
  const percent = Math.round(((now - base) / base) * PERCENT_SCALE);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/** @param {number | null} medianMs @param {number} overLimit */
const timeText = (medianMs, overLimit) => `${medianMs ?? "over"}${overLimit ? ` (${overLimit}×)` : ""}`;

/** @param {(string | number)[]} cells */
const tableLine = (cells) => cells.map((cell, index) => String(cell).padStart(COLUMN_WIDTHS[index])).join(" ");

/** @param {string} title @param {[string, string | number, string | number, string][]} rows */
function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log(tableLine(["case", "base", "now", "change"]));
  rows.forEach((row) => console.log(tableLine(row)));
}

/** @param {any} base @param {any} current */
function printComparison(base, current) {
  printTable("real engine, ms (median; (n×) = runs over the engine limit)", Object.keys(current.engine).map((key) => {
    const before = base.engine[key] ?? { medianMs: null, overLimit: 0 };
    const after = current.engine[key];
    return [key, timeText(before.medianMs, before.overLimit), timeText(after.medianMs, after.overLimit), changeText(before.medianMs, after.medianMs)];
  }));
  printTable("node structure, host calls (elements)", Object.keys(current.structure).map((key) => {
    const before = base.structure[key] ?? { hostCalls: null, elements: null };
    const after = current.structure[key];
    return [key, `${before.hostCalls} (${before.elements})`, `${after.hostCalls} (${after.elements})`, changeText(before.hostCalls, after.hostCalls)];
  }));
  printTable("one poll", [
    ["writes/poll", base.poll.sharedWrites, current.poll.sharedWrites, changeText(base.poll.sharedWrites, current.poll.sharedWrites)],
    ["bytes/poll", base.poll.sharedBytes, current.poll.sharedBytes, changeText(base.poll.sharedBytes, current.poll.sharedBytes)],
  ]);
}

/** @param {string} modDir @param {ReturnType<typeof buildFixture>} fixture @param {(modDir: string) => Record<string, any>} engine */
async function measure(modDir, fixture, engine) {
  const { structure, poll } = await measureStructure(modDir, fixture);
  return { createdAt: new Date().toISOString(), engine: engine(modDir), structure, poll };
}

/** @param {string} ref @param {string} folder */
function extractModOf(ref, folder) {
  const archive = execFileSync("git", ["-C", REPOSITORY_ROOT, "archive", ref, "mods/herdwatch"], { maxBuffer: GIT_ARCHIVE_MAX_BYTES });
  execFileSync("tar", ["-x", "-C", folder], { input: archive });
  return join(folder, "mods/herdwatch");
}

/**
 * Old and new runs alternate, so a change in machine load hits both sides alike.
 * @param {string} oldModDir @param {ReturnType<typeof buildFixture>} fixture
 */
function abEngine(oldModDir, fixture) {
  const oldEngine = {};
  const newEngine = {};
  for (const spec of ENGINE_CASES) {
    const { key } = parseCase(spec);
    const oldFolder = caseFolder(oldModDir, fixture, spec);
    const newFolder = caseFolder(MOD_DIR, fixture, spec);
    const oldTimes = [];
    const newTimes = [];
    try {
      for (let run = 0; run < AB_RUNS_PER_SIDE; run++) {
        oldTimes.push(runOnce(oldFolder));
        newTimes.push(runOnce(newFolder));
      }
    } finally {
      removeFolder(oldFolder);
      removeFolder(newFolder);
    }
    oldEngine[key] = summarize(oldTimes);
    newEngine[key] = summarize(newTimes);
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  return { oldEngine, newEngine };
}

/** @param {string} ref @param {ReturnType<typeof buildFixture>} fixture */
async function runAgainst(ref, fixture) {
  const refFolder = mkdtempSync(join(tmpdir(), "herdwatch-bench-ref-"));
  try {
    const oldModDir = extractModOf(ref, refFolder);
    const { oldEngine, newEngine } = abEngine(oldModDir, fixture);
    const before = await measure(oldModDir, fixture, () => oldEngine);
    const after = await measure(MOD_DIR, fixture, () => newEngine);
    console.log(`A/B: base = ${ref}, now = working tree, ${AB_RUNS_PER_SIDE} runs each`);
    printComparison(before, after);
  } finally {
    removeFolder(refFolder);
  }
}

async function main() {
  const commandArguments = process.argv.slice(2);
  const fixture = buildFixture(Math.floor(Date.now() / 1000));
  const againstIndex = commandArguments.indexOf("--against");
  if (againstIndex >= 0) {
    const ref = commandArguments[againstIndex + 1];
    if (!ref) throw new Error("--against needs a git ref, e.g. --against HEAD");
    await runAgainst(ref, fixture);
    return;
  }
  const current = await measure(MOD_DIR, fixture, (modDir) => measureEngine(modDir, fixture));
  if (commandArguments.includes("--save")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`baseline saved to ${BASELINE_PATH}`);
  }
  if (!existsSync(BASELINE_PATH)) {
    console.log("no bench/baseline.json yet: run npm run bench:save");
    return;
  }
  printComparison(JSON.parse(readFileSync(BASELINE_PATH, "utf8")), current);
}

await main();

import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { programMark } from "../mods/herdwatch/program-marks.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HERDR_HOME = join(homedir(), ".config/herdr-app");
const OWN_MARK_PREFIX = "mods/herdwatch/";
const NAMES = ["node", "next-server", "vite", "esbuild", "webpack", "turbo", "bun", "deno", "python", "uvicorn", "gunicorn", "flask",
  "django-admin", "ruby", "rails", "puma", "dockerd", "containerd", "docker-proxy", "podman", "postgres", "redis-server", "mongod",
  "mysqld", "mariadbd", "nginx", "caddy", "java", "go", "gopls", "cargo", "rust-analyzer", "chrome", "Electron", "ollama", "elasticsearch",
  "beam.smp", "kubectl", "kubelet", "sshd", "git", "tmux", "nvim", "vim"];

test("versions, suffixes and helper names resolve to the program's mark", () => {
  assert.equal(programMark("next-server (v15.1)").name, "Next.js");
  assert.equal(programMark("python3.12").name, "Python");
  assert.equal(programMark("Python").name, "Python");
  assert.equal(programMark("Google Chrome Helper").name, "Chrome");
  assert.equal(programMark("com.docker.backend").name, "Docker");
  assert.equal(programMark("dockerd").name, "Docker");
  assert.equal(programMark("postgres").name, "PostgreSQL");
});

test("a program without a mark gets nothing, never the sheep", () => {
  assert.equal(programMark("kworker/3:1"), null);
  assert.equal(programMark("systemd-logind"), null);
  assert.equal(programMark(""), null);
});

test("every mark in the table is a file that exists", () => {
  const hasHerdrIcons = existsSync(join(HERDR_HOME, "icons"));
  for (const name of NAMES) {
    const mark = programMark(name);
    assert.ok(mark, name);
    const isOwnMark = mark.path.startsWith(OWN_MARK_PREFIX);
    if (isOwnMark) assert.ok(existsSync(join(REPO_ROOT, "mods", mark.path.slice("mods/".length))), mark.path);
    else if (hasHerdrIcons) assert.ok(existsSync(join(HERDR_HOME, mark.path)), mark.path);
  }
});

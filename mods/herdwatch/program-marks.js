import { herdrMark } from "./agent-marks.js";

/** @typedef {import("./agent-marks.js").AgentMark} ProgramMark */

const OWN_MARKS_FOLDER = "mods/herdwatch/icons/programs";
const VERSION_IN_PARENTHESES = /\s*\(v?[\d.]+\)$/;
const TRAILING_VERSION = /[\d.]+$/;

/** @param {string} file @param {string} name @returns {ProgramMark} */
const ownMark = (file, name) => ({ name, path: `${OWN_MARKS_FOLDER}/${file}`, tint: true, isDefault: false });

const MARKS = {
  node: herdrMark("node", "Node.js", true),
  next: herdrMark("next", "Next.js", true),
  python: herdrMark("python", "Python", true),
  fastapi: herdrMark("fastapi", "FastAPI", true),
  django: herdrMark("django-admin", "Django", true),
  docker: herdrMark("docker", "Docker", true),
  postgres: herdrMark("psql", "PostgreSQL", true),
  redis: herdrMark("redis-cli", "Redis", true),
  mongodb: herdrMark("mongosh", "MongoDB", true),
  mysql: herdrMark("mysql", "MySQL", true),
  go: herdrMark("go", "Go", true),
  rust: herdrMark("cargo", "Rust", true),
  electron: herdrMark("electron", "Electron", true),
  kubernetes: herdrMark("kubectl", "Kubernetes", true),
  ssh: herdrMark("ssh", "SSH", true),
  rails: ownMark("rubyonrails.svg", "Rails"),
  chrome: ownMark("googlechrome.svg", "Chrome"),
};

/**
 * Lower-case process names, after the version is gone. A name that is not here gets no mark.
 * @type {Record<string, ProgramMark>}
 */
const PROGRAM_MARKS = {
  node: MARKS.node,
  "next-server": MARKS.next,
  next: MARKS.next,
  vite: herdrMark("vite", "Vite", true),
  esbuild: herdrMark("esbuild", "esbuild", true),
  webpack: herdrMark("webpack", "webpack", true),
  turbo: herdrMark("turbo", "Turborepo", true),
  bun: herdrMark("bun", "Bun", true),
  deno: herdrMark("deno", "Deno", true),
  python: MARKS.python,
  uvicorn: MARKS.fastapi,
  fastapi: MARKS.fastapi,
  gunicorn: ownMark("gunicorn.svg", "Gunicorn"),
  flask: herdrMark("flask", "Flask", true),
  "django-admin": MARKS.django,
  "manage.py": MARKS.django,
  ruby: herdrMark("ruby", "Ruby", true),
  rails: MARKS.rails,
  puma: MARKS.rails,
  docker: MARKS.docker,
  dockerd: MARKS.docker,
  containerd: MARKS.docker,
  "docker-proxy": MARKS.docker,
  podman: herdrMark("podman", "Podman", true),
  postgres: MARKS.postgres,
  postmaster: MARKS.postgres,
  "redis-server": MARKS.redis,
  mongod: MARKS.mongodb,
  mysqld: MARKS.mysql,
  mariadbd: MARKS.mysql,
  nginx: herdrMark("nginx", "nginx", true),
  caddy: herdrMark("caddy", "Caddy", true),
  java: herdrMark("java", "Java", true),
  go: MARKS.go,
  gopls: MARKS.go,
  cargo: MARKS.rust,
  rustc: MARKS.rust,
  "rust-analyzer": MARKS.rust,
  electron: MARKS.electron,
  ollama: herdrMark("ollama", "Ollama", true),
  elasticsearch: ownMark("elasticsearch.svg", "Elasticsearch"),
  "beam.smp": ownMark("rabbitmq.svg", "RabbitMQ"),
  kubectl: MARKS.kubernetes,
  kubelet: MARKS.kubernetes,
  ssh: MARKS.ssh,
  sshd: MARKS.ssh,
  git: herdrMark("git", "git", true),
  tmux: herdrMark("tmux", "tmux", true),
  nvim: herdrMark("nvim", "Neovim", true),
  vim: herdrMark("vim", "Vim", true),
  chrome: MARKS.chrome,
  chromium: MARKS.chrome,
};

/** @type {[RegExp, ProgramMark][]} */
const PROGRAM_PATTERNS = [
  [/^(google )?chrome|^chromium/i, MARKS.chrome],
  [/^com\.docker\./, MARKS.docker],
  [/^(rails|puma)\b/, MARKS.rails],
  [/^electron/i, MARKS.electron],
];

const MAX_CACHED_NAMES = 256;
/** @type {Map<string, ProgramMark | null>} */
const markOfName = new Map();

/** @param {string} name */
const listedMarkOf = (name) => (Object.hasOwn(PROGRAM_MARKS, name) ? PROGRAM_MARKS[name] : null);

/** @param {string} processName @returns {ProgramMark | null} */
function findMark(processName) {
  const name = processName.trim().replace(VERSION_IN_PARENTHESES, "").toLowerCase();
  const exactMark = listedMarkOf(name) ?? listedMarkOf(name.replace(TRAILING_VERSION, ""));
  if (exactMark) return exactMark;
  return PROGRAM_PATTERNS.find(([pattern]) => pattern.test(processName.trim()))?.[1] ?? null;
}

/**
 * The mark of a common program, from its process name ("next-server (v15.1)", "python3.12", "Google Chrome Helper").
 * A host runs the same programs from poll to poll, so each name is looked up once.
 * @param {string} processName
 * @returns {ProgramMark | null} null when the program has no mark
 */
export function programMark(processName) {
  if (markOfName.has(processName)) return markOfName.get(processName);
  if (markOfName.size >= MAX_CACHED_NAMES) markOfName.clear();
  const mark = findMark(processName);
  markOfName.set(processName, mark);
  return mark;
}

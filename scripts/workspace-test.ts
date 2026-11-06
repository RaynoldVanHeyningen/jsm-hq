// An agent's clone is made by git on the host and used by git in the sandbox, which can't see the
// host's settings. On a host that turns LF into CRLF on checkout (Windows' default) the two still
// have to agree on what's in the folder. The host's setting is simulated, so this runs on every CI OS.
//
//   npx tsx scripts/workspace-test.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { managedWorkspace } from "../server/paths";
import { detectRepo } from "../server/repo";
import { newAgent } from "../server/store";
import { ensureWorkspace } from "../server/workspace";
import type { AgentConfig } from "../src/data/types";

const tmp = mkdtempSync(join(tmpdir(), "hq-workspace-"));
const crlfConfig = join(tmp, "crlf.gitconfig"); // a Windows host
const plainConfig = join(tmp, "plain.gitconfig"); // a sandbox, or a macOS/Linux host
writeFileSync(crlfConfig, "[core]\n\tautocrlf = true\n");
writeFileSync(plainConfig, "");

// HQ's own git calls act as the host. Agent folders land in tmp, not the real ~/.jsmhq.
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: crlfConfig });

const git = (config: string, cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: config } });
const host = (cwd: string, ...args: string[]) => git(crlfConfig, cwd, ...args);
const sandbox = (cwd: string, ...args: string[]) => git(plainConfig, cwd, ...args);

// latin1 keeps every byte as it is, so these see exactly what's on disk.
const read = (dir: string, file: string) => readFileSync(join(dir, file), "latin1");
const write = (dir: string, files: Record<string, string>) => {
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content, "latin1");
};
const clonesOwnSettings = (dir: string) => readFileSync(join(dir, ".git", "config"), "utf8");

function same(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const NOTES_LF = "one\ntwo\n";
const NOTES_CRLF = "one\r\ntwo\r\n";
const SCRIPT_LF = "#!/bin/sh\necho hi\n";

const source = join(tmp, "source");
mkdirSync(source);
write(source, { "notes.txt": NOTES_LF, "mixed.txt": "x\ny\n", "run.sh": SCRIPT_LF });
git(plainConfig, source, "init", "-q", "-b", "main");
git(plainConfig, source, "add", ".");
git(plainConfig, source, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "init");
const repo = await detectRepo(source);

const SLUG = "test";
const agent = (id: string, patch: Partial<AgentConfig> = {}): AgentConfig => ({ ...newAgent(id, id, "Developer", "#ffffff", false), ...patch });

const tests: [string, () => Promise<void>][] = [
  [
    "new clone on a CRLF host: clean in the sandbox, LF on disk",
    async () => {
      const dir = await ensureWorkspace(agent("fresh"), SLUG, repo);
      same("git status in the sandbox", sandbox(dir, "status", "--short"), "");
      same("script the sandbox can run", read(dir, "run.sh"), SCRIPT_LF);
      // A CRLF file an agent adds doesn't reach the repo as CRLF.
      write(dir, { "new.txt": "mine\r\n" });
      sandbox(dir, "add", "new.txt");
      same("new file as committed", sandbox(dir, "show", ":new.txt"), "mine\n");
    },
  ],
  [
    "older clone: git sees only real changes, commits LF, files untouched",
    async () => {
      const dir = managedWorkspace(SLUG, "older");
      host(tmp, "clone", "--quiet", source, dir);
      const edited = "one\r\ntwo\r\nedited\r\n"; // a real edit, in the CRLF file
      const mixed = "x\r\ny\r\nz\n"; // a sandbox tool added an LF line to a CRLF file
      const staged = "#!/bin/sh\r\necho staged\r\n";
      write(dir, { "notes.txt": edited, "mixed.txt": mixed, "scratch.txt": "mine\r\n", "run.sh": staged });
      host(dir, "add", "run.sh");

      await ensureWorkspace(agent("older"), SLUG, repo);

      // HQ changes the clone's setting, never an agent's files.
      same("edited file on disk", read(dir, "notes.txt"), edited);
      same("mixed file on disk", read(dir, "mixed.txt"), mixed);
      same("staged file on disk", read(dir, "run.sh"), staged);
      same("untracked file on disk", read(dir, "scratch.txt"), "mine\r\n");

      same("git status in the sandbox", sandbox(dir, "status", "--short"), " M mixed.txt\n M notes.txt\nM  run.sh\n?? scratch.txt\n");
      same("diff shows only the real edit", sandbox(dir, "diff", "--numstat", "notes.txt"), "1\t0\tnotes.txt\n");
      same("staged edit is still staged", sandbox(dir, "diff", "--cached", "--numstat"), "1\t1\trun.sh\n");

      // What an agent's `git add -A` would commit.
      sandbox(dir, "add", "-A");
      same("edited file as committed", sandbox(dir, "show", ":notes.txt"), "one\ntwo\nedited\n");
      same("new file as committed", sandbox(dir, "show", ":scratch.txt"), "mine\n");
    },
  ],
  [
    "Local mode runs on the host: keeps the host's line endings",
    async () => {
      const dir = await ensureWorkspace(agent("local", { mode: "local" }), SLUG, repo);
      same("file on disk", read(dir, "notes.txt"), NOTES_CRLF);
      same("clone has its own autocrlf", clonesOwnSettings(dir).includes("autocrlf"), false);
    },
  ],
  [
    "a folder the user chose is left alone",
    async () => {
      const own = join(tmp, "own");
      host(tmp, "clone", "--quiet", source, own);
      await ensureWorkspace(agent("chosen", { workspacePath: own }), SLUG, repo);
      same("file on disk", read(own, "notes.txt"), NOTES_CRLF);
      same("folder has its own autocrlf", clonesOwnSettings(own).includes("autocrlf"), false);
    },
  ],
  [
    "a host that doesn't convert (macOS, Linux): plain clone, and the clone's settings don't decide",
    async () => {
      process.env.GIT_CONFIG_GLOBAL = plainConfig;
      try {
        const dir = await ensureWorkspace(agent("plain"), SLUG, repo);
        same("file on disk", read(dir, "notes.txt"), NOTES_LF);
        same("clone has its own autocrlf", clonesOwnSettings(dir).includes("autocrlf"), false);
        // The folder is the agent's to change, so what's in it doesn't get to trigger anything.
        sandbox(dir, "config", "core.autocrlf", "true");
        await ensureWorkspace(agent("plain"), SLUG, repo);
        same("clone's setting after a Start", sandbox(dir, "config", "--get", "core.autocrlf"), "true\n");
      } finally {
        process.env.GIT_CONFIG_GLOBAL = crlfConfig;
      }
    },
  ],
];

let failed = false;
for (const [name, test] of tests) {
  try {
    await test();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* Windows may still hold a file */
}
process.exit(failed ? 1 : 0);

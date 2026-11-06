// Agent folders: an HQ-managed clone per agent, or a folder the user chose.

import { existsSync } from "node:fs";
import type { AgentConfig } from "../src/data/types";
import { agentRead, agentWrite } from "./lib/agentFs";
import { run } from "./lib/exec";
import { log } from "./lib/log";
import { managedWorkspace } from "./paths";
import type { RepoInfo } from "./repo";

export function workspaceFor(agent: AgentConfig, projectSlug: string): string {
  return agent.workspacePath || managedWorkspace(projectSlug, agent.id);
}

/**
 * Makes sure the agent's folder exists and is a git repo.
 * A full clone (not a worktree): inside a sandbox a worktree loses git access.
 */
export async function ensureWorkspace(agent: AgentConfig, projectSlug: string, repo: RepoInfo): Promise<string> {
  const dir = workspaceFor(agent, projectSlug);
  if (agent.workspacePath) {
    if (!existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
    if (!(await run("git", ["rev-parse", "--git-dir"], { cwd: dir })).ok) throw new Error(`${dir} is not a git repository.`);
    return dir;
  }
  if (!existsSync(dir)) {
    const clone = await run("git", ["clone", "--quiet", repo.root, dir], { timeoutMs: 300_000 });
    if (!clone.ok) throw new Error(`git clone failed: ${clone.stderr.trim()}`);
  }
  // A local clone points origin at the folder; agents need the real remote to push.
  if (repo.originUrl) await run("git", ["remote", "set-url", "origin", repo.originUrl], { cwd: dir });
  if (agent.mode === "sandbox") await useLfInClone(dir);
  return dir;
}

/**
 * Git on the host may turn LF into CRLF on checkout (Windows' default). The sandbox's git can't see
 * that setting, so it would show every file as changed and an agent would commit the CRLF; scripts
 * wouldn't run either. So the clone gets its own setting (`input`: LF on disk, and on commit), and
 * the files git converted go back to LF. In place, because a new checkout would lose uncommitted work.
 * Only once: from then on the clone's own setting is what's read here. Set last, so a repair that
 * was cut short runs again.
 */
async function useLfInClone(dir: string) {
  // --type=bool: `yes` or `1` count as true; `input` isn't a bool, so it reads as empty.
  const autocrlf = await run("git", ["config", "--type=bool", "--get", "core.autocrlf"], { cwd: dir });
  if (autocrlf.stdout.trim() !== "true") return;
  const files = await run("git", ["ls-files", "--stage", "--eol", "-z"], { cwd: dir, timeoutMs: 120_000 });
  const converted: string[] = [];
  for (const entry of files.stdout.split("\0")) {
    // "<mode> <blob> <stage><tab>i/lf  w/crlf  attr/text=auto  <tab>path": LF in git, CRLF on disk. Attributes can ask for that on purpose.
    const m = entry.match(/^(\d+ \w+ \d+)\ti\/lf\s+w\/(?:crlf|mixed)\s+attr\/(.*?)\s*\t(.+)$/s);
    if (!m || /-text|eol=crlf/.test(m[2])) continue;
    try {
      // latin1 keeps every byte as it is, whatever the file's encoding.
      const text = agentRead(dir, m[3], "latin1");
      if (text === null) continue;
      agentWrite(dir, m[3], text.replace(/\r\n/g, "\n"), "latin1");
      converted.push(`${m[1]}\t${m[3]}\0`);
    } catch (err) {
      log.warn(`couldn't change line endings of ${m[3]} in ${dir}:`, err instanceof Error ? err.message : err);
    }
  }
  // The index still has each file's CRLF size, and git calls a different size "changed" without
  // reading the file. Adding the same entries again clears the size and keeps anything staged.
  if (converted.length) await run("git", ["update-index", "-z", "--index-info"], { cwd: dir, input: converted.join("") });
  await run("git", ["config", "core.autocrlf", "input"], { cwd: dir });
}

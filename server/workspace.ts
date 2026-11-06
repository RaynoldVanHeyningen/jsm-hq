// Agent folders: an HQ-managed clone per agent, or a folder the user chose.

import { existsSync } from "node:fs";
import type { AgentConfig } from "../src/data/types";
import { run } from "./lib/exec";
import { managedWorkspace, projectHome } from "./paths";
import type { RepoInfo } from "./repo";

export function workspaceFor(agent: AgentConfig, projectSlug: string): string {
  return agent.workspacePath || managedWorkspace(projectSlug, agent.id);
}

/**
 * Whether git on the host turns LF into CRLF on checkout (Windows' default). Read from HQ's own
 * folder: what's in an agent's clone is the agent's to change, so it doesn't get a say.
 */
async function hostConvertsToCrlf(projectSlug: string): Promise<boolean> {
  const r = await run("git", ["config", "--type=bool", "--get", "core.autocrlf"], { cwd: projectHome(projectSlug) });
  return r.stdout.trim() === "true";
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
  // The sandbox's git can't see the host's setting, so it would show every CRLF file as changed and
  // an agent would commit the CRLF. A sandboxed agent's clone gets its own: LF on checkout and on commit.
  const lf = agent.mode === "sandbox" && (await hostConvertsToCrlf(projectSlug));
  if (!existsSync(dir)) {
    const clone = await run("git", ["clone", "--quiet", ...(lf ? ["-c", "core.autocrlf=input"] : []), repo.root, dir], { timeoutMs: 300_000 });
    if (!clone.ok) throw new Error(`git clone failed: ${clone.stderr.trim()}`);
  } else if (lf) {
    // An older clone. Its files stay CRLF until they're next checked out, but git now reads them correctly.
    await run("git", ["config", "core.autocrlf", "input"], { cwd: dir });
  }
  // A local clone points origin at the folder; agents need the real remote to push.
  if (repo.originUrl) await run("git", ["remote", "set-url", "origin", repo.originUrl], { cwd: dir });
  return dir;
}

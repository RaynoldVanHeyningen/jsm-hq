// Files HQ writes into an agent's folder. The agent controls that folder (it is
// mounted into its sandbox), so it could swap a file or folder for a symlink to
// a host path. These helpers never follow a symlink out of the folder: a
// symlinked folder on the way is refused, a symlinked file is replaced (writes)
// or treated as missing (reads).

import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync, type WriteFileOptions } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const lstat = (p: string) => {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
};

/** The absolute path for `rel` inside `root`, after checking no folder on the way is a symlink. */
export function agentPath(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const inside = relative(resolve(root), abs);
  if (!inside || inside.startsWith("..") || resolve(root, inside) !== abs) throw new Error(`${rel} is outside the agent's folder`);
  let cur = resolve(root);
  for (const part of inside.split(sep).slice(0, -1)) {
    cur = join(cur, part);
    if (lstat(cur)?.isSymbolicLink()) throw new Error(`${relative(root, cur)} in ${root} is a symlink; HQ won't write through it. Remove it and start again.`);
  }
  return abs;
}

/** Creates the folders for `rel` (each checked) inside `root`. */
export function agentMkdir(root: string, rel: string) {
  const abs = agentPath(root, join(rel, "x"));
  mkdirSync(dirname(abs), { recursive: true });
  agentPath(root, join(rel, "x")); // re-check after creating
}

/** Writes a file inside the agent's folder. A symlink in its place is replaced, never followed. */
export function agentWrite(root: string, rel: string, data: string, opts?: WriteFileOptions) {
  const abs = agentPath(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  agentPath(root, rel);
  if (lstat(abs)?.isSymbolicLink()) rmSync(abs);
  writeFileSync(abs, data, opts);
}

/** Reads a file inside the agent's folder; a missing file or a symlink reads as null. */
export function agentRead(root: string, rel: string): string | null {
  const abs = agentPath(root, rel);
  const st = lstat(abs);
  if (!st || st.isSymbolicLink() || !st.isFile()) return null;
  return readFileSync(abs, "utf8");
}

/** Deletes a path inside the agent's folder (a symlink itself, never its target). */
export function agentRemove(root: string, rel: string) {
  rmSync(agentPath(root, rel), { recursive: true, force: true });
}

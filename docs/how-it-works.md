# How JSM HQ works

What HQ does behind the office: where agents work, how they talk, what reaches GitHub, and what HQ saves. New here? Start with the [getting-started guide](getting-started.md).

- [The team](#the-team)
- [Workspaces and sessions](#workspaces-and-sessions)
- [Messages between agents](#messages-between-agents)
- [GitHub and reviews](#github-and-reviews)
- [Sandboxes and network access](#sandboxes-and-network-access)
- [Terminals, links and ports](#terminals-links-and-ports)
- [Action items](#action-items)
- [Your stack](#your-stack)
- [MCP servers](#mcp-servers)
- [App variables and keys](#app-variables-and-keys)
- [Settings you can change any time](#settings-you-can-change-any-time)
- [What HQ saves, and where](#what-hq-saves-and-where)
- [Windows](#windows)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The team

- **The lead** plans and assigns. It creates boards (for example one per phase), splits the work into tasks and gives each task to a free worker. It never writes app code.
- **Workers** build. One task means one branch and one pull request. A worker edits only the files its task lists and asks the lead if it needs more.
- Each agent runs **Claude Code** or **Codex**, in a **Sandbox** (the default) or in **Local** mode. Set this per agent in Settings → Team.

New teams get names from The Office: Michael leads, then Dwight, Jim, Pam and so on. Rename them any time.

## Workspaces and sessions

- **Its own copy of the repo.** Each agent gets a full clone at `~/.jsmhq/<project>/<agent>/`. Your own working folder is never touched.
- **Its instructions.** HQ writes `.jsmhq-role.md` into that folder: the agent's role (the ROLE.md text from Settings → Team), the team, the rules and its tools. HQ also adds its hooks and MCP config there, and keeps all of these out of git. If the folder has its own `ROLE.md`, HQ includes it and never overwrites it.
- **Its session.** On macOS and Linux each agent runs in a tmux session called `hq-<project>-<agent>`, so agents keep working if you close HQ or the browser. You can watch one from any terminal with `tmux attach -t hq-<project>-<agent>`, or open its drawer in HQ.

## Messages between agents

Agents talk to each other and to HQ through an MCP server called `hq`, which HQ runs for them.

- The lead uses it to create boards and tasks and to assign them. Any agent can send a message.
- A message is delivered right away if the agent is idle, or when it finishes its current step if it's busy.
- You can message any agent from the **Messages** tab in its drawer.

## GitHub and reviews

HQ reads your PRs, checks and review comments with your `gh` login, about every 20 seconds.

- It matches a PR to its task by the `[TASK-ID]` at the start of the title.
- New review comments are sent to the PR's author to fix.
- When a PR passes review, the lead is told it's ready to merge.
- When a PR is merged, its task is marked done.
- If a PR has merge conflicts with `main`, the author is told to fix them.

**HQ never merges.** You merge on GitHub.

Pick the review tool in Settings → Workflow: CodeRabbit, Greptile, Copilot, you, or your own.

## Sandboxes and network access

Each agent in Sandbox mode runs in its own [Docker Sandbox](https://docs.docker.com/ai/sandboxes/), a small VM with its own copy of the repo. It can't reach the rest of your machine.

- **Network policy.** You choose one when you install Docker Sandboxes. **Balanced** is recommended: AI services, package registries and GitHub are allowed, everything else is blocked. HQ never changes it; it only adds the one rule that lets sandboxes reach HQ.
- **When an agent needs a website** (a tool's docs or an API), it asks with the `request_access` tool instead of working around the block. Its card turns red and its drawer shows **Allow for this agent / Allow for everyone / Deny**.
- **Blocked requests** the agent didn't ask about are listed too: the agent's card shows "N blocked", and its drawer lists them with **Allow / Dismiss**.
- **Allowing a website** adds a rule for that sandbox only. Your base policy is never touched, and HQ only removes rules it added.
- **CPU and memory** are set in Settings → Sandbox. A sandbox gets its size when it's created, so after changing it press **Recreate sandbox**. Stop and Start keeps the old size. Recreating keeps the agent's folder and code but clears anything installed inside the sandbox.

## Terminals, links and ports

- **Resize any panel.** Drag a panel's left edge to make it wider (HQ remembers the width in this browser; double-click the edge to reset), or press the square button to fill the screen. Terminals resize with it, so full-screen tools that need more rows fit.
- **Shell tab.** A shell inside the agent's sandbox (or its folder in Local mode), beside the agent.
- **Terminal** (top bar). Your own shell on this machine, not in a sandbox: in your repo, an agent's folder, or any folder you type. Be careful in an agent's folder while it's working: it's the same copy of the repo the agent is editing.
- **Links** in any terminal open in a new tab when you click them, including long URLs that wrap onto the next line.
- **Opening the browser.** Tools in a sandbox that open a web page (for example a CLI sign-in) open it in your browser.
- **Ports.** When a program in the Shell tab prints a `localhost:<port>` address, HQ offers to **Forward port**: then `localhost:<port>` on your machine reaches the sandbox. CLI sign-ins that redirect your browser back to `localhost` need this. You can also forward any port, and stop forwarding, in the agent's **Sandbox** tab. The program inside the sandbox must listen on all addresses (`0.0.0.0`), not only `127.0.0.1`.

## Action items

**Action items** in the top bar is everything waiting on you:

- requests from agents (made with the `ask_user` tool): create a database, add a key, change a dashboard setting. Each one has exact steps and names the variable, never the secret value;
- agents waiting for an answer in their terminal;
- websites agents asked to reach, and ones their sandbox blocked;
- pull requests ready to merge.

Mark a request **Done** (with an optional note) or **Dismiss** it, and HQ tells the agent so it can continue. Action items stay on your machine and are never committed.

## Your stack

Optional. In Settings → Stack (or during the welcome), pick what the project uses: frameworks, plus tools for auth, payments, database, analytics and security. You can also add your own under "Other".

- Agents see the stack in their instructions.
- Each tool's official agent skills are installed into the agents' folders (`.claude/skills`, `.agents/skills`), kept out of git.
- One click allows every tool's docs and API websites for all sandboxes.

Skip it and nothing changes.

## MCP servers

Give agents extra tools (Supabase, Stripe, Figma, your own…) in **Settings → MCP**:

1. **Add server:** a URL and an optional API key, or a command for a local server. Tools from your stack fill in their URL for you.
2. **Sign in** if the server asks. Sign-ins and keys stay with Docker Sandboxes and never enter a sandbox.
3. **Tick the agents** that should get it. A running agent gets the tools right away, without a restart.

Unticking a server takes effect when that agent's sandbox is recreated, because Docker Sandboxes can't detach a server from one sandbox.

**Supabase tip:** add `?project_ref=<id>` to the URL (Supabase → Project Settings → General) so the agent can only reach that project. Use a development project, not production.

## App variables and keys

- **App variables** (Settings → Sandbox → App variables) become environment variables in the agent's session and its Shell tab. They're not a `.env` file in the project. Agents are told the names, never the values. Restart the agent after changing them.
- **Service keys** (Settings → Sandbox) go to Docker Sandboxes' secret store. A sandbox's proxy adds the key to matching requests, so the key itself never enters the VM.

HQ never stores key values and never reads your env files.

## Settings you can change any time

| Setting | Where | Applies |
| --- | --- | --- |
| Office name (the sign on the wall) | Settings → Project | Right away, for everyone on the project |
| Font: Pixel, Clean or Mono | Settings → Project | Right away, in this browser only. The office itself stays pixel. |
| Review tool | Settings → Workflow | Right away |
| Agents, roles, CLI, mode | Settings → Team | Next time the agent starts |
| CPU and memory | Settings → Sandbox | After **Recreate sandbox** |
| MCP servers per agent | Settings → MCP | Right away for new servers |

## What HQ saves, and where

| File | What | Commit it? |
| --- | --- | --- |
| `.jsmhq/config.json` (in your repo) | Team, workflow, stack, office name | Yes, so your team shares it |
| `.jsmhq/plan.json` (in your repo) | Boards and tasks | Yes |
| `docs/plan.md` (in your repo) | A readable copy of the plan, if **Settings → Project → Export plan** is on | Yes |
| `~/.jsmhq/<project>/` | Agents' folders, app variables, action items and HQ's own records | No, it's outside your repo, on your machine only |

**Remove a project:** delete each agent in Settings → Team (this removes its sandbox and, if you choose, its folder), then delete `~/.jsmhq/<project>`.

## Windows

Windows 11 support is experimental. Run HQ in PowerShell or Windows Terminal, not in WSL.

- There's no tmux, so HQ runs the agents itself. **Agents stop when HQ stops.** Their sandboxes and folders are kept; press **Start** to run them again.
- Use the terminal in the agent's drawer; there's no `tmux attach`.
- In Local mode, the agent's env file isn't loaded. Use Sandbox mode for app variables.
- A sandboxed agent's clone uses LF line endings, whatever your git's `core.autocrlf` says, because the sandbox runs Linux. A clone from an older HQ keeps its CRLF files until they're checked out again: git handles them correctly, but if a script won't run, use `rm <file> && git checkout <file>` in the Shell tab. HQ doesn't change a folder you picked for an agent yourself: if git shows every file as changed inside the sandbox, run `git config core.autocrlf input` in that folder.

## Keyboard shortcuts

| Key | Does |
| --- | --- |
| `1`–`9` | Open that agent |
| `Esc` | Close panels |
| `+` / `-` | Zoom in / out |
| `D` | Toggle the debug panel |

Drag to move around the office; scroll to zoom.

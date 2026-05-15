# smartchats — CLI

> One-stop CLI for the open-source SmartChats voice AI agent. Launch the local stack, verify it, sign in to cloud, import/export data — single entry point.

## Install

```bash
npm install -g smartchats-ai
```

After install, both `smartchats` and `smartchats-ai` are on your PATH (same binary, two aliases).

Or run without installing:

```bash
npx smartchats-ai <command>
```

## Quick start

```bash
smartchats launch           # interactive: prompts for API keys, builds image, runs container
smartchats launch --test    # automated: launches detached, waits for ready, runs doctor
smartchats doctor           # diagnostic: checks docker, image, container, port 3000, LLM keys
smartchats --help           # everything else
```

After `launch`, open <http://localhost:3000>.

## Commands

| Command | What it does |
|---|---|
| `smartchats launch` | Build the AIO docker image (first run only — a few minutes) and run it. Prompts for OpenAI / Anthropic / Google / Serper API keys, writes them to `.env`, persists SurrealDB data under `~/.smartchats/aio/` (or `$XDG_DATA_HOME/smartchats/aio/`). |
| `smartchats launch --test` | Launch detached, wait until the stack responds on port 3000, run `doctor`, exit with doctor's exit code. Good for CI smoke checks. |
| `smartchats doctor` | Diagnostic table: Docker present? Image built? Container running? Port responsive? Is the page actually SmartChats? Any LLM key configured? Returns non-zero if any **critical** check fails. |
| `smartchats login` | Sign in to the SmartChats cloud SaaS (browser OAuth). Credentials cached at `~/.smartchats-mcp/credentials.json` — shared with the MCP server. |
| `smartchats logout` | Clear cached cloud credentials. |
| `smartchats whoami` | Show current cloud user. |
| `smartchats data export <file>` | Save user data to a JSON bundle (`--target=cloud` or `--target=local`). |
| `smartchats data import <file>` | Load a JSON bundle into a deployment. |

## Configuration

| Knob | Default | Purpose |
|---|---|---|
| `SMARTCHATS_HOME` | (auto-detected via dir walk) | Explicit path to a smartchats repo clone. Set this when running the CLI from outside the repo. |
| `SMARTCHATS_CONFIG_FILE` | `$XDG_CONFIG_HOME/smartchats/config.json` or `~/.smartchats/config.json` | CLI preferences (last-used mode, port, etc.). |
| `SMARTCHATS_CREDENTIALS_FILE` | `~/.smartchats-mcp/credentials.json` | Cloud OAuth credentials cache. |
| `XDG_DATA_HOME` | `~/.smartchats` | Base path for AIO container data (`<XDG_DATA_HOME>/aio/`). |

The CLI never asks for credentials twice — it reads from your environment first, then `.env`, then prompts.

## How it works on a fresh machine

On first run, `smartchats launch` auto-clones the smartchats repo into `~/.smartchats/repo/` (or `$XDG_DATA_HOME/smartchats/repo/`), which has the `Dockerfile.aio` needed to build the AIO image. Subsequent runs reuse the clone.

To use your own clone instead, pass `--repo-path /path/to/clone` or set `$SMARTCHATS_HOME`.

## Status

Phase 1 — published as `smartchats-ai` on npm. Auto-clones the source repo on first run; future phases will ship pre-built Docker images so no clone is needed at all.

- Ship pre-built Docker images on Docker Hub so first-run skips the local build
- Add `--mode byo-db` for bringing your own SurrealDB instance
- Add `--mode dev` to subsume hot-reload development flows

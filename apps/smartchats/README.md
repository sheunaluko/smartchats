# SmartChats

A voice-first AI agent that runs locally on your machine. Self-hostable, BYO API keys, no cloud account required.

## Quick start

```bash
npx smartchats
```

That's it. The CLI:
1. Detects API keys you already have in your environment (`OPENAI_API_KEY`, etc.)
2. Asks if you want to use them or enter different ones
3. Builds the image (one container, ~5 min on first run)
4. Starts SmartChats on <http://localhost:3000>

Subsequent runs are ~10s. Hit `Ctrl-C` to stop. Data persists at `~/.smartchats/data`.

## Configuration

Provider keys — at least an OpenAI key is required. The CLI checks these env vars in order (first match wins, mirroring the server):

| Provider | Env names |
|---|---|
| OpenAI | `SMARTCHATS_OPENAI_API_KEY`, `OPENAI_API_KEY` |
| Anthropic | `SMARTCHATS_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY` |
| Google (Gemini) | `SMARTCHATS_GOOGLE_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY` |
| Serper (web search) | `SMARTCHATS_SERPER_API_KEY`, `SERPER_API_KEY` |

CLI flags:

```text
npx smartchats [--no-prompt] [--rebuild] [-d] [--port N] [--data-dir PATH]
```

- `--no-prompt` — skip prompts, use whatever's in env / `.env`
- `--rebuild` — rebuild the docker image (first run, after upgrades)
- `-d` — run in the background (`docker stop smartchats` to stop)
- `--port` — host port (default 3000)
- `--data-dir` — where SurrealDB persists state (default `~/.smartchats/data`)

## What you get

- **Multi-provider chat** — OpenAI, Anthropic, Google. Switch mid-conversation.
- **Voice-first** — VAD + speech recognition + low-latency streaming TTS.
- **Knowledge graph** — entity-relation triples persisted in SurrealDB; queryable, visualizable.
- **Code execution** — sandboxed JavaScript with workspace state.
- **Apps** — declarative agent functions installable on demand.
- **BYO API keys** — your keys, your data, no cloud middleman.

## Stack

| Layer | What | Where |
|---|---|---|
| Frontend | Next.js 14 + Zustand store | `apps/smartchats/` |
| Backend | Express + LocalBackend adapter | `packages/smartchats-local-server/` |
| Data | SurrealDB | bundled in the AIO image |
| Voice | Tivi (VAD + STT + TTS queue) | `packages/tivi/` |
| Agent | Cortex (LLM streaming + structured-output runners) | `packages/cortex/` |
| LLM service | Multi-provider streaming + structured output | `packages/llm-service/` |
| Knowledge graph viz | sigma.js + graphology + react-sigma | `packages/graph-viz/` |
| Test harness | Simi (declarative workflow runner) | `packages/simi/` |

## Architecture: one container vs three

The default `npx smartchats` packages SurrealDB + Express server + Next.js into a **single container** (the AIO image, defined in `Dockerfile.aio`). Browser sees only `localhost:3000`; the server proxies API calls to the Express backend over container loopback. One image, one port, one volume.

For development, the repo also ships a **three-service `docker-compose.yml`** with separate containers for SurrealDB, the server, and the app. Use this if you want to:
- Restart one component without restarting the others
- Replace one half (e.g., your own server hitting our Next.js front-end)
- Watch logs streamed by service
- Scale the front-end behind a CDN

```bash
# Three-service variant for dev
cp .env.example .env
# edit .env to add provider keys
docker compose up
```

## Test suite

```bash
cd apps/smartchats
SIMI_REUSE_BROWSER=1 NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP=local \
  npx playwright test simi.spec.ts
```

26 workflows cover chat, sessions, knowledge graph, code execution, agent delegation, app lifecycle, BYO keys, usage tracking, and more.

## Hacking on the source

```bash
# 1. Run SurrealDB locally
docker run -p 8000:8000 surrealdb/surrealdb:latest \
  start --user root --pass root --bind 0.0.0.0:8000

# 2. Start the local server
cd packages/smartchats-local-server
SMARTCHATS_OPENAI_API_KEY=sk-... npm run dev

# 3. Start the Next.js app
cd apps/smartchats
NEXT_PUBLIC_SMARTCHATS_BOOTSTRAP=local npm run dev
```

## License

Apache 2.0 (open core). The cloud-backed variant lives in a separate private repo.

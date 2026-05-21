# SmartChats

**The future of agentic voice experiences. Now.**

SmartChats is an open source voice-native AI platform. Voice in. Code, charts, web answers, and persistent knowledge — out. SmartChats turns conversation into a computing surface that gets smarter every time you use it.

→ [smartchats.ai](https://smartchats.ai) · [docs](https://smartchats.ai/docs)

---

## Status

🟢 **Production-ready · Open-core release · 2026 Q2**

The full stack is live: voice pipeline, knowledge graph, sandboxed code execution, multi-provider LLM routing (GPT-5.5 / Claude Opus 4.7 / Gemini 3.1 Pro), MCP server, billing, end-to-end test coverage. Active daily use; deploys ship continuously.

**This repo is the open core.** Everything you need to self-host the same stack on your own machine is here under MIT. The hosted SaaS at [smartchats.ai](https://smartchats.ai) runs on top of this — only the multi-tenant production cloud orchestration (billing back-end, hosted database, infrastructure) stays private.

→ **[Read the docs](https://smartchats.ai/docs)** for architecture, quickstart, self-hosting, CLI reference, MCP integration, package-by-package guides, and contribution workflow.

## Quick start

### Option 1 — Run the CLI against the hosted SaaS

```bash
npx smartchats-ai
```

Auto-clones this repo on first run, logs you into the hosted SaaS, and launches the local web app pointed at the cloud backend. Free tier included.

### Option 2 — Self-host the full stack

```bash
git clone https://github.com/sheunaluko/smartchats.git
cd smartchats
npm install
bin/aio                           # one-command all-in-one container
# OR
bin/devserve                      # local dev — SurrealDB + Next.js
```

Open [http://localhost:3000](http://localhost:3000). Bring your own API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) or use the hosted billing.

Full self-hosting guide: [smartchats.ai/docs/self-host](https://smartchats.ai/docs/self-host)

## Roadmap

| Quarter | Milestone |
|---|---|
| **Now (Q2 2026)** | **Open Core + Hosted.** MIT-licensed source release. Hosted web app live with managed billing, auth, and infrastructure. |
| Q3 2026 | **Integrations + Mobile.** Native mobile app launch. Third-party integrations buildout — Gmail, Calendar, X, GitHub, and more — so SmartChats can read, write, and act across the apps where users already live. |
| Q4 2026 | **Enterprise.** Three offerings: drop-in voice agent SDK (Tivi), drop-in voice + agent runtime (Tivi + Cortex), and full closed-cloud licensing with deployment support for regulated environments. White-label and self-hosted across all tiers. |

## Architecture

The full stack ships open under MIT — frontend, local server, schema, voice pipeline, agent runtime, MCP server, CLI. The entire app self-hosts with one command. Only multi-tenant cloud orchestration stays private.

**Core layers:**

- **Voice** ([`tivi`](https://smartchats.ai/docs/packages/tivi)) — ONNX VAD (Silero v5), streaming STT, per-utterance TTS, two-phase mic calibration, designed for natural turn-taking with interruption.
- **Agent runtime** ([`cortex`](https://smartchats.ai/docs/packages/cortex)) — multi-provider LLM router, JSON-stream parser, function-calling loop, background process manager, modular prompt composition.
- **Output** — sandboxed JavaScript execution (iframe + proxy membrane), entity-relation knowledge graph (SurrealDB triple store + HNSW vector index, 1536-dim embeddings), multi-modal renderers.
- **Interop** ([`smartchats-mcp`](https://smartchats.ai/docs/mcp)) — first-class Model Context Protocol, both directions: SmartChats consumes external MCP servers AND exposes itself as one. Read your data from any MCP-aware LLM; write into your account from any MCP-aware tool.

Full architecture writeup: [smartchats.ai/docs/architecture](https://smartchats.ai/docs/architecture).

## Packages

This is a TypeScript monorepo. Each package is independently usable — drop `tivi` into a different React app, embed `cortex` in your own agent, run `smartchats-sessions` analyzers on exported bundles. Per-package docs at [smartchats.ai/docs/packages](https://smartchats.ai/docs/packages).

| Package | What it does |
|---|---|
| [`tivi`](https://smartchats.ai/docs/packages/tivi) | Browser voice interface: VAD, STT, TTS, calibration |
| [`cortex`](https://smartchats.ai/docs/packages/cortex) | Function-calling agent runtime + sandbox executor |
| [`smartchats-database`](https://smartchats.ai/docs/packages/smartchats-database) | Pure SurrealQL query builders + ops layer |
| [`smartchats-backend`](https://smartchats.ai/docs/packages/smartchats-backend) | HTTP transport contract, streaming helpers |
| [`smartchats-sessions`](https://smartchats.ai/docs/packages/smartchats-sessions) | Session export + per-session analyzers + cross-session triage |
| [`llm-service`](https://smartchats.ai/docs/packages/llm-service) | Provider-agnostic LLM client (Anthropic / OpenAI / Gemini) |
| [`simi`](https://smartchats.ai/docs/packages/simi) | Declarative E2E workflow tests |
| `smartchats-cli` *(npm: [`smartchats-ai`](https://www.npmjs.com/package/smartchats-ai))* | The `smartchats` command-line tool |
| `smartchats-mcp` | MCP server — expose SmartChats to Claude Desktop / any MCP client |
| `graph-viz`, `smartchats-common`, `smartchats-local-server`, `smartchats-backend-local`, `smartchats-cloud-client`, `smartchats-test` | Supporting libraries |

## Contributing

A full contribution policy is being prepared. In the meantime, please reach out before opening pull requests:

- 📧 [shay@smartchats.ai](mailto:shay@smartchats.ai)
- 💼 [LinkedIn](https://www.linkedin.com/in/sheun-aluko/)

For everything else:

- 🐛 [Issues](https://github.com/sheunaluko/smartchats/issues) — bugs, feature requests, questions
- 💬 [Discussions](https://github.com/sheunaluko/smartchats/discussions) — design conversations, show-and-tell
- 📖 [Docs](https://smartchats.ai/docs) — everything

## License

[MIT](LICENSE)

## Contact

**Sheun Aluko, MD, MS** — Founder & CEO

- 💼 [LinkedIn](https://www.linkedin.com/in/sheun-aluko/)


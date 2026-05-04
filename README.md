# SmartChats

**The future of agentic voice experiences. Now.**

SmartChats is an open source voice-native AI platform. Voice in. Code, charts, web answers, and persistent knowledge — out. SmartChats turns conversation into a computing surface that gets smarter every time you use it.

→ [smartchats.ai](https://smartchats.ai) · [docs](https://smartchats.ai/docs)

---

## Status

🟢 **Production-ready · Stealth · 2026 Q2**

The full stack is live and operational: voice pipeline, knowledge graph, sandboxed code execution, multi-provider LLM routing (GPT-5.5 / Claude Opus 4.7 / Gemini 3.1 Pro), MCP server, billing infrastructure, end-to-end test coverage. Active daily use; deploys ship continuously.

The hosted SaaS is at [smartchats.ai](https://smartchats.ai). The full open-core source — everything you need to self-host the same stack on your own machine — drops publicly in **Q2 2026** under MIT license. See roadmap below.

→ **[Read the docs](https://smartchats.ai/docs)** for architecture, CLI reference, MCP integration, self-hosting guide, and contribution guidelines.

## Roadmap

| Quarter | Milestone |
|---|---|
| Now | **Production stack live in stealth.** Hosted SaaS at smartchats.ai with active users; full feature set operational. |
| Q2 2026 | **Open Core + Hosted.** MIT-licensed source release. Hosted web app product with managed billing, auth, and infrastructure goes public. |
| Q3 2026 | **Integrations + Mobile App.** Mobile app launch. Third-party integrations buildout — Gmail, Calendar, X, GitHub, and more — so SmartChats can read, write, and act across the apps where users already live. |
| Q4 2026 | **Enterprise.** Three offerings: drop-in voice agent SDK (Tivi), drop-in voice + agent runtime (Tivi + Cortex), and full closed-cloud licensing with deployment support for regulated environments. White-label and self-hosted options across all tiers. |

## Architecture (preview)

The full stack — frontend, local server, schema, voice pipeline, agent runtime, MCP server, CLI — ships open-source under MIT, so the entire app can be self-hosted with one command. Only the production cloud orchestration (billing, multi-tenant infrastructure, hosted database) stays private.

Core layers:
- **Voice** — Tivi: ONNX VAD (Silero v5), streaming STT, per-utterance TTS, designed for natural turn-taking.
- **Cortex** — multi-provider LLM router, JSON-stream parser, function-calling loop, background processes.
- **Output** — sandboxed JavaScript execution (iframe + proxy membrane), entity-relation knowledge graph (SurrealDB triple store + HNSW vector index, 1536-dim embeddings), multi-modal renderers.
- **Interop** — first-class Model Context Protocol, both directions: SmartChats consumes external MCP servers and exposes itself as one. Read your data from any MCP-aware LLM; write into your account from any MCP-aware tool.

The full architecture writeup is in the [docs](https://smartchats.ai/docs/architecture).

## Local development (this repo)

This repo houses the public smartchats.ai site (marketing + docs). It's a Next.js app:

```bash
git clone https://github.com/sheunaluko/smartchats.git
cd smartchats
npm install
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000) — landing page at `/`, docs at `/docs`.

Stack: Next.js 14 (App Router for landing, Pages Router for docs) · TypeScript · Tailwind 3 · Nextra v3 · GSAP · lucide-react.

## License

[MIT](LICENSE)

## Contact

**Sheun Aluko, MD, MS** — Founder & CEO

- 💼 [LinkedIn](https://www.linkedin.com/in/sheun-aluko/)
- 🎤 Demo on request

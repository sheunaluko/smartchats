# SmartChats

**The future of agentic voice experiences. Now.**

SmartChats is an open source voice-native AI platform. Voice in. Code, charts, web answers, and persistent knowledge — out. SmartChats turns conversation into a computing surface that gets smarter every time you use it.

→ [smartchats.ai](https://smartchats.ai)

---

## Status

🟢 **Stealth · 2026 Q2**

The product itself is a working prototype with the full stack operational — voice pipeline, knowledge graph, sandboxed code execution, multi-provider LLM routing (GPT-5.5 / Claude Opus 4.7 / Gemini 3.1 Pro), and billing infrastructure all live. Active daily development.

This repository currently houses the marketing site at [smartchats.ai](https://smartchats.ai). The full open-core source drops in **Q2 2026** under MIT license — see roadmap below.

## Roadmap

| Quarter | Milestone |
|---|---|
| Now | **Stealth.** Working prototype, full stack operational. |
| Q2 2026 | **Open Core + Hosted.** MIT-licensed source release. Hosted web app product with managed billing, auth, and infrastructure ships publicly to prosumer users. |
| Q3 2026 | **Integrations + Mobile App.** Mobile app launch. Third-party integrations buildout — Gmail, Calendar, X, GitHub, and more — so SmartChats can read, write, and act across the apps where users already live. |
| Q4 2026 | **Enterprise.** Drop-in voice agent SDK — a JS / web component that lets any external product embed SmartChats' full stack (voice, KG, sandboxed execution) without building it themselves. White-label and self-hosted options for regulated environments. |

## Architecture (preview)

The full stack — frontend, local server, schema, voice pipeline — will ship open-source under MIT, so the entire app can be self-hosted. Only the production cloud backend (billing, auth, multi-tenant) stays private; that's what provides data synchronization across all devices for subscribing users.

Core layers:
- **Voice** — Tivi: ONNX VAD (Silero v5), streaming STT, per-utterance TTS, 2-chunk early-split for low first-utterance delay.
- **Cortex** — multi-provider LLM router, JSON-stream parser, function-calling loop, background processes.
- **Output** — sandboxed JavaScript execution (iframe + proxy membrane), entity-relation knowledge graph (SurrealDB triple store + HNSW vector index, 1536-dim embeddings), multi-modal renderers.
- **Interop** — first-class Model Context Protocol, both directions: SmartChats consumes external MCP servers and exposes itself as one.

## Local development (this site)

```bash
git clone https://github.com/sheunaluko/smartchats.git
cd smartchats
npm install
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000).

Stack: Next.js 14 (App Router) · TypeScript · Tailwind 3 · GSAP · lucide-react. Static site at deploy time — no runtime server needed.

## License

[MIT](LICENSE)

## Contact

**Sheun Aluko, MD, MS** — Founder & CEO

- ✉ [shay@sattvicsystems.com](mailto:shay@sattvicsystems.com)
- 💼 [LinkedIn](https://www.linkedin.com/in/sheun-aluko/)
- 🎤 Demo on request

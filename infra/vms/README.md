# `infra/vms/` — local VM definitions for sm

VM-backed test environments for `sm vm`. Two drivers, mirrored layout:

```
infra/vms/
├── lima/                       Lima — Linux on Mac (lightweight, fast)
│   ├── linux.yaml              Ubuntu 24.04, fresh
│   └── provision.sh            Runs once on first boot: install + keys
└── tart/                       Tart — macOS on macOS (Apple Silicon only)
    ├── mac.yaml                Sonoma, fresh
    └── provision.sh            macOS version of the same setup
```

## Why both

- **Lima** — what you want 99% of the time. ~30s boot, native Linux performance, repo mounts as `/work`.
- **Tart** — only when you genuinely need to test stock macOS install behaviour. Apple Silicon only. Slower to provision (Tart pulls a multi-GB macOS image once).

## Host keys → VM

API keys live at `~/.smartchats/keys.env` on the host. `sm vm up` reads
that file and injects the values into the VM's environment at boot.
Keys never get written to disk inside the VM (they live in the boot
env only). Format:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
```

`--no-keys` skips injection (e.g., when you want a clean image to snapshot).

## Port forwarding

Both drivers forward `3000` (smartchats web) and `8000` (SurrealDB
admin) by default. Customize in the YAML config if you need more.

## Adding a new config

1. Copy an existing YAML in the right driver dir.
2. Tweak (different distro, more memory, etc.).
3. Register in `packages/sm/src/commands/vm.ts`'s `VM_REGISTRY`.
4. Done — `sm vm up <name>` works.

# smartchats-tunnel

Fly.io-hosted SSH bastion. Rendezvous point for two SSH sessions —
one publishing (dev-box), one consuming (laptop) — so the laptop's
browser can hit `http://localhost:3000` and reach a dev server on the
dev-box without either machine accepting inbound SSH.

## Why this exists

Testing the cloud SmartChats app from a laptop against a dev server on
a Mac requires the browser to see `http://localhost:3000` in the URL
bar. Two reasons:

1. **`getUserMedia()` for voice.** Browsers require a secure context
   (HTTPS or `localhost`). Any other hostname over plain HTTP → no
   mic access.
2. **Firebase's `connectFunctionsEmulator(hostname, 5001)`.** Callables
   go to `<hostname>:5001` where `hostname === window.location.hostname`.
   Only works if `hostname === 'localhost'` and the laptop has a real
   listener on `localhost:5001`.

An SSH bastion satisfies both with zero client-side app changes.

## Data flow

```
Mac (dev box)                    Fly bastion             Laptop
─────────────                    ───────────             ──────
dev :3000, :5001                 sshd :2222 public       browser
     ▲                                ▲                     │
     │ ssh -N -R … tunnel@…           │                     │ URL: http://localhost:3000
     │                                │                     ▼
     │                                │             127.0.0.1:3000 listener
     │                                │              (from ssh -N -L … tunnel@…)
     │                                │                     │
     └────────────────────────────────┴─────────────────────┘
                sshd routes on 127.0.0.1
```

Mac's `-R 3000:localhost:3000` opens a listener on the bastion's
`127.0.0.1:3000`. Laptop's `-L 3000:localhost:3000` opens a listener on
the laptop's `127.0.0.1:3000` and tells the bastion's sshd to dial
`localhost:3000` on the bastion side when the listener gets a
connection. Sshd multiplexes the two SSH channels together on
loopback.

## Setup (one-time)

You'll need the Fly CLI (`flyctl`) installed and authenticated:

```
brew install flyctl        # or your platform's install method
fly auth login
```

Then, from this directory:

```
# 1. Create the app
fly apps create smartchats-tunnel

# 2. Allocate a dedicated IPv4 (required for raw-TCP pass-through)
fly ips allocate-v4 -a smartchats-tunnel

# 3. Create the volume for persistent host keys
fly volumes create tunnel_hostkeys -r iad -s 1 -a smartchats-tunnel

# 4. Set the authorized_keys as a secret
#    (multi-line file — one ssh-... line per client that should be
#     allowed to open tunnels)
fly secrets set TUNNEL_AUTHORIZED_KEYS="$(cat authorized_bastion_keys)" -a smartchats-tunnel

# 5. Deploy
fly deploy -a smartchats-tunnel
```

`authorized_bastion_keys` in step 4 is a plain text file you maintain —
one `ssh-ed25519 …` public-key line per client machine. Rotating the
key set = edit the file, re-run step 4, `fly deploy` picks up the new
secret automatically.

Steps 1-5 can be run via `sm tunnel up` from either the open or cloud
smartchats repo — it wraps this whole sequence with idempotency +
preflight checks.

## Connecting

### From the dev box (publisher — the `-R` side)

```
ssh -N \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=2 \
    -o ExitOnForwardFailure=yes \
    -R 3000:localhost:3000 \
    -R 5001:localhost:5001 \
    tunnel@smartchats-tunnel.fly.dev -p 2222
```

Or via `sm tunnel connect` — it runs this in the background and prints
the laptop-side command to paste.

**Why `ExitOnForwardFailure=yes` is not optional here.** If a previous
Mac session died uncleanly, its `127.0.0.1:3000` listener stays bound
on the bastion for up to `ClientAliveInterval * ClientAliveCountMax`
(30s with the config in this package). During that window, a reconnect
attempt from the Mac hits "port in use" on the sshd side. **Without
`ExitOnForwardFailure=yes`, ssh silently accepts the failure and keeps
the SSH connection up with no working forward** — the laptop's browser
sees a live tunnel that dead-ends into nothing. With
`ExitOnForwardFailure=yes`, the ssh client exits nonzero on the
zombie-listener collision so a supervisor loop can retry.

### From the laptop (consumer — the `-L` side)

```
ssh -N \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=2 \
    -L 3000:localhost:3000 \
    -L 5001:localhost:5001 \
    tunnel@smartchats-tunnel.fly.dev -p 2222
```

Then browse to `http://localhost:3000`. Voice + callables both work
because the browser sees `localhost`.

## Host keys

The Docker image mounts `/etc/ssh` from the `tunnel_hostkeys` Fly
volume. First boot generates ed25519 + rsa host keys; subsequent boots
reuse them. This means clients only need to accept the host key **once**
— it stays stable across deploys.

To view the host-key fingerprints (e.g. to compare against what a
client sees on first connect):

```
fly logs -a smartchats-tunnel | grep 'host key:'
```

## Cost

- shared-cpu-1x + 256MB RAM + 1GB volume + 1 dedicated IPv4: **~$4/mo** always-running.
- `auto_stop_machines = false` in v1 because Fly's auto-stop is
  unreliable with long-lived TCP connections. Set `min_machines_running`
  to 0 and `auto_stop = true` when you're comfortable that Fly's TCP
  autostop respects live connections (community reports are mixed as
  of mid-2026).

## Security model

- Pubkey-only auth.
- Non-root `tunnel` user with `/sbin/nologin` shell — SSH forwarding
  works before the shell is invoked, so `-N` is enforced by the
  shell-not-runnable configuration.
- `PermitListen 127.0.0.1:*` — `-R` binds can only reach the bastion's
  loopback. If a key ever leaks, the bastion can't be repurposed as a
  public port exposer.
- `PermitOpen 127.0.0.1:*` — `-L` dials can only reach the bastion's
  loopback. Blocks the bastion being used as a SOCKS proxy into
  Fly-internal networks.
- Modern KEX/ciphers/MACs only.
- Fly TCP LB is a raw byte-pipe — no proxy protocol, no TLS
  interception.

## Not implemented (deliberate v1 scope)

- Multi-tenant (each user runs their own bastion — cheap enough).
- `sm tunnel add-key` (v1 rotates via editing the file + `fly secrets set`).
- Autossh-style reconnect supervision (v1 leaves that to shell; a
  future `sm tunnel connect --supervise` verb could run `autossh` or
  a plain `while :; ssh …; sleep 2; done` loop).
- HTTP endpoint proxying (bastion is TCP-only in v1).

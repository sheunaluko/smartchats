#!/bin/sh
# entrypoint.sh — boot the smartchats-tunnel sshd bastion.
#
# Steps, in order:
#   1. Write authorized_keys from the TUNNEL_AUTHORIZED_KEYS env var (fly secret).
#   2. Ensure host keys exist (generate + save on first boot). Persisted to
#      the fly volume mount at /etc/ssh so client known_hosts entries survive
#      deploys.
#   3. Set correct permissions.
#   4. Exec sshd in the foreground.
#
# If TUNNEL_AUTHORIZED_KEYS is empty, sshd still starts — but no client can
# auth. Log the situation loudly so `fly logs` makes the misconfiguration
# obvious.

set -eu

TUNNEL_USER=tunnel
AUTHORIZED_KEYS=/home/${TUNNEL_USER}/.ssh/authorized_keys

# ── 1. authorized_keys from env ────────────────────────────────────────
if [ -n "${TUNNEL_AUTHORIZED_KEYS:-}" ]; then
    # printf preserves multi-line content the way `echo -e` doesn't
    # portably. TUNNEL_AUTHORIZED_KEYS should be set as a multi-line
    # fly secret (fly secrets set TUNNEL_AUTHORIZED_KEYS=$'key1\nkey2').
    printf '%s\n' "${TUNNEL_AUTHORIZED_KEYS}" > "${AUTHORIZED_KEYS}"
    chown ${TUNNEL_USER}:${TUNNEL_USER} "${AUTHORIZED_KEYS}"
    chmod 600 "${AUTHORIZED_KEYS}"
    key_count=$(grep -c '^ssh-' "${AUTHORIZED_KEYS}" 2>/dev/null || echo 0)
    echo "[entrypoint] wrote ${key_count} authorized key(s) from TUNNEL_AUTHORIZED_KEYS"
else
    echo "[entrypoint] WARNING: TUNNEL_AUTHORIZED_KEYS is empty — sshd will start but no client can auth"
    echo "[entrypoint] fix: fly secrets set TUNNEL_AUTHORIZED_KEYS=\"\$(cat ~/.ssh/id_ed25519.pub)\" -a smartchats-tunnel"
    : > "${AUTHORIZED_KEYS}"
    chown ${TUNNEL_USER}:${TUNNEL_USER} "${AUTHORIZED_KEYS}"
    chmod 600 "${AUTHORIZED_KEYS}"
fi

# ── 2. Host keys — generate on first boot only ─────────────────────────
# /etc/ssh should be a fly volume mount so this survives deploys. If it's
# not mounted, keys get regenerated every restart — client known_hosts
# entries will require -o StrictHostKeyChecking=accept-new or manual
# accept.
for keytype in ed25519 rsa; do
    keyfile="/etc/ssh/ssh_host_${keytype}_key"
    if [ ! -f "${keyfile}" ]; then
        echo "[entrypoint] generating ${keytype} host key"
        ssh-keygen -t "${keytype}" -f "${keyfile}" -N "" -q
        # ssh-keygen normally chmods to 600, but be explicit.
        chmod 600 "${keyfile}"
        chmod 644 "${keyfile}.pub"
    fi
done

# ── 3. Print host-key fingerprints so `fly logs` gives an easy way to
# verify what clients see on first connect. ─────────────────────────────
for keyfile in /etc/ssh/ssh_host_*_key.pub; do
    if [ -f "${keyfile}" ]; then
        ssh-keygen -l -f "${keyfile}" | sed 's/^/[entrypoint] host key: /'
    fi
done

# ── 4. Exec sshd in the foreground ─────────────────────────────────────
# -D: don't daemonize (fly needs pid 1 in foreground)
# -e: log to stderr (fly captures it)
echo "[entrypoint] starting sshd on :2222"
exec /usr/sbin/sshd -D -e

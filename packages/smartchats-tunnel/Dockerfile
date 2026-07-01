# smartchats-tunnel — SSH bastion on Fly.io.
#
# Both endpoints (dev-box Mac and laptop) connect OUT to this image over
# Tailscale-free public TCP:2222 → sshd's internal :22. No inbound firewall
# rules on the dev machines; no symmetric SSH between them.
#
# The dev box publishes local dev-server ports via `ssh -R` reverse tunnels
# to the bastion; the laptop consumes them via `ssh -L` forward tunnels.
# sshd's channel multiplexer wires the two sides together on the bastion's
# loopback interface.
#
# Auth: pubkey only. authorized_keys is written by entrypoint.sh from the
# TUNNEL_AUTHORIZED_KEYS env var (a fly secret), one key per line.
#
# Host keys: persisted to /etc/ssh via the mounted fly volume so keys
# survive deploys — otherwise every deploy invalidates every client's
# known_hosts entry.

FROM alpine:3.20

# openssh-server: sshd
# tini: init that reaps zombies + handles signals cleanly
# ca-certificates: for outbound HTTPS if entrypoint ever needs it
RUN apk add --no-cache openssh-server tini ca-certificates \
    && rm -rf /var/cache/apk/*

# Non-root tunnel user. Shell is /sbin/nologin — SSH -N -R/-L forwarding
# works BEFORE the user shell is invoked, so nologin doesn't block the
# tunnel. This makes "forgot -N" fail-closed (interactive login refused)
# without breaking the actual tunneling behavior. To debug from inside
# the container use `fly ssh console` as root.
RUN adduser -D -s /sbin/nologin -h /home/tunnel tunnel \
    && mkdir -p /home/tunnel/.ssh \
    && chown -R tunnel:tunnel /home/tunnel/.ssh \
    && chmod 700 /home/tunnel/.ssh \
    # Alpine's adduser -D leaves the shadow entry with `!` (locked
    # account), which sshd refuses to authenticate even for pubkey
    # login ("User tunnel not allowed because account is locked").
    # Replace `!` with `*` — semantics: no valid password (still can't
    # login with password), but account is not "locked" from sshd's
    # perspective. Pubkey auth then works.
    && sed -i 's/^tunnel:!:/tunnel:*:/' /etc/shadow

# Custom sshd_config — locks down auth to pubkey only, allows tcp forwarding.
COPY sshd_config /etc/ssh/sshd_config

# Entrypoint — writes authorized_keys, ensures host keys exist, execs sshd.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 2222 inside the container — avoid colliding with Fly's internal :22
# on the IPv6 admin interface. Fly TCP service maps public :2222 → this.
EXPOSE 2222

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]

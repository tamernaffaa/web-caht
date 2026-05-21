#!/bin/sh
set -eu

: "${TURN_PUBLIC_IP:?TURN_PUBLIC_IP is required}"
: "${TURN_USERNAME:?TURN_USERNAME is required}"
: "${TURN_PASSWORD:?TURN_PASSWORD is required}"
: "${TURN_REALM:=chat.local}"
: "${SIGNALING_DOMAIN:?SIGNALING_DOMAIN is required}"

# Render config from template using environment variables.
envsubst < /etc/coturn/turnserver.conf > /tmp/turnserver.conf

exec turnserver -c /tmp/turnserver.conf -n

#!/bin/sh
set -eu

: "${SIGNALING_DOMAIN:?SIGNALING_DOMAIN is required}"

envsubst '${SIGNALING_DOMAIN}' < /etc/nginx/templates/signaling.conf.template > /etc/nginx/conf.d/default.conf

exec "$@"

FROM instrumentisto/coturn:4.6.3-r1

USER root
RUN apk add --no-cache gettext

COPY turnserver.conf /etc/coturn/turnserver.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

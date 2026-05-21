FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

COPY signaling.conf.template /etc/nginx/templates/signaling.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]

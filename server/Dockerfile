# The AskerDo board server. node:sqlite is built into Node 24, so there is no
# npm install and no native module: the image is Node plus server/.
# On Unraid, server/unraid/install.sh builds it and makes the Docker tab app;
# by hand, from the repo root: docker build -f server/Dockerfile -t askerdo-board .
FROM node:24.14.0-slim

WORKDIR /app
COPY server/ /app/server/

# TZ is the admin's: stamps and day boundaries fall in it (docker run -e TZ=Area/City).
# Node carries its own zone data, so the slim image needs no tzdata package.
ENV NODE_ENV=production \
    TZ=UTC \
    ASKERDO_DB=/data/askerdo.db \
    ASKERDO_BACKUPS=/backups \
    ASKERDO_PORT=17480 \
    ASKERDO_HOST=0.0.0.0

VOLUME ["/data", "/backups"]
EXPOSE 17480

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.ASKERDO_PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# serve migrates first (after a backup when the schema moves), then listens
CMD ["node", "/app/server/cli.mjs", "serve"]

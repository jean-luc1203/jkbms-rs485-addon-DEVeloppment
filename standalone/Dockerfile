# Use the base Node Alpine image
FROM node:22-alpine

# Create directories required by the standalone runtime and dashboard generators.
RUN mkdir -p \
        /usr/src/node-red \
        /usr/src/node-red/runtime \
        /data \
        /config \
        /config/dashboards \
        /config/www \
        /etc/node-red \
    && chown -R node:node /usr/src/node-red \
    && chown -R node:node /data \
    && chown -R node:node /config \
    && chown -R node:node /etc/node-red

WORKDIR /usr/src/node-red

# Copy Node-RED package manifest to install dependencies.
COPY package.json /usr/src/node-red/package.json

RUN apk add --no-cache --virtual .build-dependencies \
        build-base \
        linux-headers \
        python3 \
    && npm install \
        --no-audit \
        --no-fund \
        --no-update-notifier \
        --omit=dev \
        --unsafe-perm \
    && npm rebuild --build-from-source @serialport/bindings-cpp \
    && npm cache clear --force \
    && apk del --no-cache --purge .build-dependencies \
    && rm -fr \
        /root/.cache \
        /root/.npm \
        /root/.nrpmrc \
        /tmp/* \
    && chown -R node:node /usr/src/node-red

COPY standalone/entrypoint.sh /usr/src/node-red/entrypoint.sh
RUN chmod +x /usr/src/node-red/entrypoint.sh

# Generate /data/options.json from config.yaml and Docker environment variables.
COPY standalone/envoptions.js \
     config.yaml \
     /usr/src/node-red/

# IMPORTANT:
# Keep the versioned runtime outside /data.
# /data is a persistent Docker volume; copying the image runtime directly there
# would cause an old flows.json/settings.js to survive image upgrades.
COPY rootfs/etc/node-red/flows.json \
     /usr/src/node-red/runtime/flows.json

COPY rootfs/etc/node-red/settings.js \
     /usr/src/node-red/runtime/settings.js

# Standalone Docker dashboard synchronizer.
# The flow calls this canonical path for all Lovelace dashboards.
COPY rootfs/etc/node-red/dashboard_sync_docker.js \
     /etc/node-red/dashboard_sync.js

RUN chown -R node:node /usr/src/node-red/runtime /etc/node-red

USER node

ENV NODE_PATH=/usr/src/node-red/node_modules:/data/node_modules \
    PATH=/usr/src/node-red/node_modules/.bin:${PATH} \
    FLOWS=flows.json

EXPOSE 1880

ENTRYPOINT ["./entrypoint.sh"]

LABEL \
    org.opencontainers.image.title="jkbms-rs485-standalone" \
    org.opencontainers.image.description="Standalone Docker image for running the JK-BMS RS485 and CAN bus integration with Home Assistant Docker."

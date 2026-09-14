#!/bin/sh
set -eu

RUNTIME_DIR="/usr/src/node-red/runtime"
DATA_DIR="/data"
CONFIG_DIR="/config"

# Persistent directories may come from Docker named/bind volumes.
mkdir -p \
    "${DATA_DIR}" \
    "${CONFIG_DIR}/dashboards" \
    "${CONFIG_DIR}/www"

# The packaged runtime is immutable inside the image.
# Refresh only the versioned Node-RED runtime files on every container start.
# Persistent files such as:
#   /data/options.json
#   /data/smart_jkbms_premium.json
# remain in /data and are not deleted.
for runtime_file in flows.json settings.js; do
    src="${RUNTIME_DIR}/${runtime_file}"
    dst="${DATA_DIR}/${runtime_file}"

    if [ ! -r "${src}" ]; then
        echo "ERROR: packaged runtime file missing: ${src}" >&2
        exit 1
    fi

    cp "${src}" "${dst}"
done

echo "JK-BMS standalone runtime refreshed from image:"
echo "  ${RUNTIME_DIR}/flows.json -> ${DATA_DIR}/flows.json"
echo "  ${RUNTIME_DIR}/settings.js -> ${DATA_DIR}/settings.js"

# Generate /data/options.json from config.yaml and Docker environment variables.
node /usr/src/node-red/envoptions.js

# Start Node-RED as PID 1 so Docker stop/restart signals are delivered directly.
exec node ${NODE_OPTIONS:-} \
    node_modules/node-red/red.js \
    --userDir "${DATA_DIR}" \
    "${FLOWS:-flows.json}" \
    "$@"

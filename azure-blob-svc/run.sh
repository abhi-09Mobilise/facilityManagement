#!/usr/bin/env bash
# Start the Azure Blob sidecar in the foreground.
# For systemd see azure-blob.service in this folder.
set -euo pipefail
cd "$(dirname "$0")"
exec node server.js

#!/usr/bin/env bash
set -euo pipefail
# Portable checkout initialization. Agent workflows own project dependencies.
pnpm install --frozen-lockfile

#!/bin/sh
# Mac / Linux: precisa do Node.js (https://nodejs.org)
cd "$(dirname "$0")"
( sleep 1; (command -v open >/dev/null && open http://localhost:8090/) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8090/) ) &
exec node ponte/ponte.js

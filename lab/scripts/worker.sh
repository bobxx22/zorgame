#!/usr/bin/env bash
# lab :: worker
# Night search on a remote server (Linux, Node 24): build, delivery, status, report.
# The server doesn't need the @zoria registry: packages travel ready-made from bot/ and lab/,
# there are no secrets in the bundle. Access - by an SSH key:
#   ZORIA_WORKER=root@host  ZORIA_WORKER_KEY=~/.ssh/zoria_worker  (port - ZORIA_WORKER_PORT, 22)
#
#   scripts/worker.sh deploy                   build the bot and the bundle, deploy to /opt/zoria
#   scripts/worker.sh start <search flags>     search as the zoria-search service (survives an SSH drop)
#   scripts/worker.sh status                   service, last log lines, memory
#   scripts/worker.sh report [id]              a search's report.md (default - the latest)
#   scripts/worker.sh pull                     fetch the server's runs/search/ into lab/runs/remote/
#   scripts/worker.sh stop                     stop the search; what's played stays, --resume continues
#   scripts/worker.sh queue <file>             (user only) a queue of searches: one line of flags per search
#
# A server without root (no sudo, systemd-run unavailable): ZORIA_WORKER_MODE=user.
# Then the search is a background setsid nohup process with a pid file, the directory -
# ZORIA_WORKER_DIR, node - ZORIA_WORKER_NODE, e.g.:
#   ZORIA_WORKER=kx@host ZORIA_WORKER_PORT=42022 ZORIA_WORKER_MODE=user \
#   ZORIA_WORKER_DIR=/home/kx/zoria ZORIA_WORKER_NODE=/home/kx/node/bin/node scripts/worker.sh status
set -euo pipefail

host=${ZORIA_WORKER:?"set ZORIA_WORKER=user@host"}
key=${ZORIA_WORKER_KEY:-$HOME/.ssh/zoria_worker}
port=${ZORIA_WORKER_PORT:-22}
ssh_=(ssh -i "$key" -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes "$host")
scp_=(scp -q -i "$key" -P "$port" -o BatchMode=yes -o IdentitiesOnly=yes)
root=$(cd "$(dirname "$0")/../.." && pwd)
remote=${ZORIA_WORKER_DIR:-/opt/zoria}
node=${ZORIA_WORKER_NODE:-/usr/local/bin/node}
mode=${ZORIA_WORKER_MODE:-systemd}
[ "$mode" = systemd ] || [ "$mode" = user ] || { echo "ZORIA_WORKER_MODE: systemd or user"; exit 2; }
pid=$remote/search.pid
log=$remote/search.log

case "${1:-}" in
  deploy)
    (cd "$root/bot" && npm run build >/dev/null)
    # which bot is deployed: the search writes it into config.json and the report header
    commit=$(cd "$root" && git rev-parse --short HEAD)$(cd "$root" && [ -z "$(git status --porcelain -- bot/src bot/nakaz.yaml bot/package.json lab/server lab/shared)" ] || echo '+uncommitted')
    printf '{"commit":"%s","at":"%s"}\n' "$commit" "$(date -u +%FT%TZ)" > "$root/lab/build.json"
    pack=$(mktemp -d)/zoria-worker.tgz
    # only what the search needs: the bot, the lab server and the four @zoria packages with yaml
    (cd "$root" && tar -czf "$pack" bot/package.json bot/nakaz.yaml bot/dist \
      bot/node_modules/@zoria/{engine,sdk,nakaz,protocol} bot/node_modules/yaml \
      lab/package.json lab/build.json lab/server lab/shared $([ -d "$root/lab/ext" ] && echo lab/ext) \
      lab/node_modules/@zoria/{engine,sdk,nakaz,protocol} lab/node_modules/yaml)
    "${scp_[@]}" "$pack" "$host:/tmp/zoria-worker.tgz"
    # the server's runs/ stays: a deployment doesn't touch what's been played
    rm -f "$root/lab/build.json"
    "${ssh_[@]}" "mkdir -p $remote && tar -xzf /tmp/zoria-worker.tgz -C $remote && rm /tmp/zoria-worker.tgz && $node -v"
    echo "deployed: $commit"
    ;;
  start)
    shift
    args=$(printf ' %q' "$@")
    if [ "$mode" = user ]; then
      # one search at a time: a live pid - refusal
      "${ssh_[@]}" "if [ -f $pid ] && kill -0 \$(cat $pid) 2>/dev/null; then echo 'a search is already running: pid '\$(cat $pid); exit 1; fi; cd $remote/lab || exit 1; setsid nohup nice -n 5 $node server/search.ts$args > $log 2>&1 < /dev/null & echo \$! > $pid; sleep 3; if kill -0 \$(cat $pid) 2>/dev/null; then echo active; else echo failed; tail -n 20 $log; exit 1; fi"
    else
      "${ssh_[@]}" "systemctl reset-failed zoria-search 2>/dev/null; systemd-run --unit=zoria-search --property=Nice=5 --working-directory=$remote/lab $node server/search.ts$args && sleep 3 && systemctl is-active zoria-search"
    fi
    ;;
  queue)
    # a queue of searches in one background process: the file - one line of search.ts flags
    # per search, empty lines and # - skipped. The next starts as soon as the previous one ends
    [ "$mode" = user ] || { echo "queue - only for ZORIA_WORKER_MODE=user"; exit 2; }
    file=${2:?"queue <file with search flags>"}
    "${ssh_[@]}" "if [ -f $pid ] && kill -0 \$(cat $pid) 2>/dev/null; then echo 'a search is already running: pid '\$(cat $pid); exit 1; fi"
    "${scp_[@]}" "$file" "$host:$remote/queue.txt"
    "${ssh_[@]}" "cat > $remote/queue.sh" <<EOF
#!/usr/bin/env bash
cd $remote/lab
while IFS= read -r line; do
  case "\$line" in ''|'#'*) continue ;; esac
  echo "== \$(date -u +%FT%TZ) \$line"
  eval "nice -n 5 $node server/search.ts \$line" || echo "== code \$?"
done < $remote/queue.txt
echo "== \$(date -u +%FT%TZ) queue empty"
EOF
    "${ssh_[@]}" "setsid nohup bash $remote/queue.sh > $log 2>&1 < /dev/null & echo \$! > $pid; sleep 3; if kill -0 \$(cat $pid) 2>/dev/null; then echo active; else echo failed; tail -n 20 $log; exit 1; fi"
    ;;
  status)
    if [ "$mode" = user ]; then
      "${ssh_[@]}" "if [ -f $pid ] && kill -0 \$(cat $pid) 2>/dev/null; then echo active; else echo inactive; fi; tail -n 6 $log 2>/dev/null | cut -c1-220; free -m | sed -n 2p; uptime"
    else
      "${ssh_[@]}" "systemctl is-active zoria-search; journalctl -u zoria-search --no-pager -n 6 | cut -c1-220; free -m | sed -n 2p; uptime"
    fi
    ;;
  report)
    id=${2:-}
    if [ -n "$id" ]; then
      [[ "$id" =~ ^[a-z0-9-]{8,40}$ ]] || { echo "search id: $id?"; exit 2; }
      "${ssh_[@]}" "cat $remote/lab/runs/search/$id/report.md"
    else
      "${ssh_[@]}" "cd $remote/lab/runs/search && cat \"\$(ls -t | head -1)/report.md\""
    fi
    ;;
  pull)
    mkdir -p "$root/lab/runs/remote"
    "${ssh_[@]}" "cd $remote/lab/runs && tar -czf - search" | tar -xzf - -C "$root/lab/runs/remote"
    ls "$root/lab/runs/remote/search"
    ;;
  stop)
    if [ "$mode" = user ]; then
      # what's played is written after every pack: TERM loses nothing, --resume continues.
      # setsid made the process a group leader: TERM to the whole group - both the queue and the search in it
      "${ssh_[@]}" "if [ -f $pid ] && kill -0 \$(cat $pid) 2>/dev/null; then kill -TERM -- -\$(cat $pid); for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 \$(cat $pid) 2>/dev/null || break; sleep 1; done; fi; kill -0 \$(cat $pid 2>/dev/null) 2>/dev/null && echo active || echo inactive"
    else
      "${ssh_[@]}" "systemctl stop zoria-search; systemctl is-active zoria-search || true"
    fi
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 2
    ;;
esac

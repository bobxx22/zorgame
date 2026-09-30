#!/usr/bin/env bash
# lab :: worker
# Нічний пошук на віддаленому сервері (Linux, Node 24): збірка, доставка, стан, звіт.
# Реєстр @zoria на сервері не потрібен: пакети їдуть готовими з bot/ і lab/, секретів
# у пакунку немає. Доступ - ключем SSH:
#   ZORIA_WORKER=root@host  ZORIA_WORKER_KEY=~/.ssh/zoria_worker  (порт - ZORIA_WORKER_PORT, 22)
#
#   scripts/worker.sh deploy                   зібрати бота і пакунок, розгорнути в /opt/zoria
#   scripts/worker.sh start <прапорці пошуку>  пошук службою zoria-search (переживає обрив SSH)
#   scripts/worker.sh status                   служба, останні рядки журналу, пам'ять
#   scripts/worker.sh report [id]              report.md пошуку (типово - останнього)
#   scripts/worker.sh pull                     забрати runs/search/ сервера в lab/runs/remote/
#   scripts/worker.sh stop                     зупинити пошук; зігране лишається, --resume продовжить
set -euo pipefail

host=${ZORIA_WORKER:?"задайте ZORIA_WORKER=user@host"}
key=${ZORIA_WORKER_KEY:-$HOME/.ssh/zoria_worker}
port=${ZORIA_WORKER_PORT:-22}
ssh_=(ssh -i "$key" -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes "$host")
scp_=(scp -q -i "$key" -P "$port" -o BatchMode=yes -o IdentitiesOnly=yes)
root=$(cd "$(dirname "$0")/../.." && pwd)
remote=/opt/zoria

case "${1:-}" in
  deploy)
    (cd "$root/bot" && npm run build >/dev/null)
    pack=$(mktemp -d)/zoria-worker.tgz
    # лише те, що потрібно пошуку: бот, сервер лабораторії і чотири пакети @zoria з yaml
    (cd "$root" && tar -czf "$pack" bot/package.json bot/nakaz.yaml bot/dist \
      bot/node_modules/@zoria/{engine,sdk,nakaz,protocol} bot/node_modules/yaml \
      lab/package.json lab/server lab/shared \
      lab/node_modules/@zoria/{engine,sdk,nakaz,protocol} lab/node_modules/yaml)
    "${scp_[@]}" "$pack" "$host:/tmp/zoria-worker.tgz"
    # runs/ сервера лишається: розгортання не чіпає зіграного
    "${ssh_[@]}" "mkdir -p $remote && tar -xzf /tmp/zoria-worker.tgz -C $remote && rm /tmp/zoria-worker.tgz && node -v"
    echo "розгорнуто: $(cd "$root" && git rev-parse --short HEAD)$(cd "$root" && git diff --quiet || echo ' + незакомічене')"
    ;;
  start)
    shift
    args=$(printf ' %q' "$@")
    "${ssh_[@]}" "systemctl reset-failed zoria-search 2>/dev/null; systemd-run --unit=zoria-search --property=Nice=5 --working-directory=$remote/lab /usr/local/bin/node server/search.ts$args && sleep 3 && systemctl is-active zoria-search"
    ;;
  status)
    "${ssh_[@]}" "systemctl is-active zoria-search; journalctl -u zoria-search --no-pager -n 6 | cut -c1-220; free -m | sed -n 2p; uptime"
    ;;
  report)
    id=${2:-}
    if [ -n "$id" ]; then
      [[ "$id" =~ ^[a-z0-9-]{8,40}$ ]] || { echo "id пошуку: $id?"; exit 2; }
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
    "${ssh_[@]}" "systemctl stop zoria-search; systemctl is-active zoria-search || true"
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac

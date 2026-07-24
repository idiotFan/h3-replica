#!/bin/bash
# 一键部署到 h3.idiotfan.wang
# 用法：./scripts/deploy.sh
set -e

REMOTE="tap-vps"
DEST="/var/www/h3"
LOCAL="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 同步文件到 ${REMOTE}:${DEST} ..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.DS_Store' \
  --exclude '.opencode' \
  --exclude '*.md' \
  --exclude 'tests' \
  --exclude '.claude' \
  -e ssh \
  "${LOCAL}/" \
  "${REMOTE}:${DEST}/"

echo "==> 验证 ..."
STATUS=$(curl -sI "https://h3.idiotfan.wang/index.html" | head -1)
echo "  $STATUS"

echo "==> 部署完成！"
echo "  https://h3.idiotfan.wang"

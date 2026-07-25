#!/bin/bash
# 一键部署到 h3.idiotfan.wang
# 用法：./scripts/deploy.sh
#
# 流程：
#   1. 算出构建版本号（UTC 时间戳 + 前端源码内容哈希）
#   2. rsync 同步站点文件（排除开发废料；sw.js 单独处理）
#   3. 远程清理历史遗留的开发文件（幂等）
#   4. 最后上传注入了版本号的 sw.js —— 放最后，保证新 SW 生效时资源已全部就位
set -euo pipefail

REMOTE="tap-vps"
DEST="/var/www/h3"
SITE="https://h3.idiotfan.wang"
LOCAL="$(cd "$(dirname "$0")/.." && pwd)"

# ---------- 1. 构建版本号 ----------
# sw.js 里的 __BUILD_VERSION__ 会被替换成它，保证每次发布 sw.js 字节都变化，
# 浏览器才会检测到新 Service Worker 并重新预缓存 / 清理旧缓存。
SRC_HASH="$(find "${LOCAL}/js" "${LOCAL}/css" "${LOCAL}/index.html" -type f \
    \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -print0 \
  | LC_ALL=C sort -z | xargs -0 shasum | shasum | cut -c1-8)"
BUILD_VERSION="$(date -u +%Y%m%d%H%M%S)-${SRC_HASH}"
echo "==> 构建版本：${BUILD_VERSION}"

if ! grep -q '__BUILD_VERSION__' "${LOCAL}/sw.js"; then
  echo "!! sw.js 里找不到 __BUILD_VERSION__ 占位符，缓存版本无法注入，终止部署。" >&2
  exit 1
fi

# ---------- 2. 同步站点文件 ----------
echo "==> 同步文件到 ${REMOTE}:${DEST} ..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.DS_Store' \
  --exclude '.opencode' \
  --exclude '*.md' \
  --exclude 'tests' \
  --exclude '.claude' \
  --exclude '.trae' \
  --exclude '.env' \
  --exclude '.venv' \
  --exclude 'MESHY_API_KEY*' \
  --exclude 'scripts' \
  --exclude 'art/preview' \
  --exclude 'art/_src' \
  --exclude '__pycache__' \
  --exclude '*.bak' \
  --exclude '*.bak2' \
  --exclude '*.bak3' \
  --exclude '*.bak*' \
  --exclude 'package-lock.json' \
  --exclude '.gitignore' \
  --exclude 'sw.js' \
  -e ssh \
  "${LOCAL}/" \
  "${REMOTE}:${DEST}/"

# ---------- 3. 远程清理历史遗留（幂等） ----------
# rsync --delete 不会删除被 --exclude 的文件，所以早期版本部署上去的开发废料
# （ART_SPEC.md、scripts/ 里的 blender 脚本和 deploy.sh、art/preview 预览图等）
# 会一直留在公网上，必须显式清掉。
echo "==> 清理远端历史遗留文件 ..."
ssh "${REMOTE}" 'bash -s' <<'REMOTE_CLEAN'
set -u
DEST="/var/www/h3"

# 只允许删 $DEST 下的路径，且路径必须是真实目录
safe_rmtree() {
  case "$1" in
    "$DEST"/?*) ;;
    *) echo "  跳过（不在 $DEST 下）：$1"; return 0 ;;
  esac
  [ -d "$1" ] || return 0
  rm -rf -- "$1" && echo "  已删除目录 $1"
}

# 3a. 文档 / 锁文件（明确列出，不用通配符）
for f in \
  "$DEST/ART_SPEC.md" \
  "$DEST/HANDOVER.md" \
  "$DEST/HANDOFF.md" \
  "$DEST/README.md" \
  "$DEST/REVIEW-2026-07-21.md" \
  "$DEST/package-lock.json" \
  "$DEST/.gitignore" \
  "$DEST/.DS_Store" \
  "$DEST/art/.DS_Store"
do
  if [ -f "$f" ]; then rm -f -- "$f" && echo "  已删除 $f"; fi
done

# 3b. 历史 REVIEW-*.md（逐个判断是不是普通文件再删）
for f in "$DEST"/REVIEW-*.md; do
  [ -f "$f" ] && rm -f -- "$f" && echo "  已删除 $f"
done

# 3c. 开发脚本目录（泄露 ssh alias / 服务器路径）与预览图目录
safe_rmtree "$DEST/scripts"
safe_rmtree "$DEST/art/preview"
safe_rmtree "$DEST/art/_src"
safe_rmtree "$DEST/tests"
safe_rmtree "$DEST/node_modules"

# 3d. 散落的备份文件
find "$DEST" -type f -name '*.bak*' -print -delete 2>/dev/null || true
find "$DEST" -type d -name '__pycache__' -print -exec rm -rf -- {} + 2>/dev/null || true

echo "  远端剩余体积：$(du -sh "$DEST" | cut -f1)"
exit 0
REMOTE_CLEAN

# ---------- 4. 上传注入版本号的 sw.js（最后一步） ----------
echo "==> 注入缓存版本号并上传 sw.js ..."
TMP_SW="$(mktemp "${TMPDIR:-/tmp}/h3-sw.XXXXXX")"
trap 'rm -f "${TMP_SW}"' EXIT
sed "s/__BUILD_VERSION__/${BUILD_VERSION}/g" "${LOCAL}/sw.js" > "${TMP_SW}"

# 注入自检：sw.js 的字节必须真的变了，否则浏览器不认为有新 SW，老用户永远轮换不到新版本
# （这正是「用户正常导航不会更新」P0 缺陷的另一半根因）。
if cmp -s "${LOCAL}/sw.js" "${TMP_SW}"; then
  echo "!! 注入后 sw.js 与源文件字节完全一致，浏览器不会检测到新 SW，终止部署。" >&2
  exit 1
fi
if grep -q '__BUILD_VERSION__' "${TMP_SW}"; then
  echo "!! 注入后仍残留 __BUILD_VERSION__ 占位符，终止部署。" >&2
  exit 1
fi
echo "  注入自检通过：版本号写入 $(grep -c "${BUILD_VERSION}" "${TMP_SW}") 行，字节已变化"

scp -q "${TMP_SW}" "${REMOTE}:${DEST}/sw.js"

# ---------- 5. 验证 ----------
# 注意：这里刻意不用 `curl ... | grep -q` —— 配合 set -o pipefail，grep -q 命中后提前退出会让
# curl 收到 SIGPIPE 返回 23，整条管道被判为失败，产生「明明成功却报错」的假阴性。
# 统一改成先取结果再用 case/字符串匹配。
echo "==> 验证 ..."
http_code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$1" || echo "000"; }

echo "  index.html: HTTP $(http_code "${SITE}/index.html")"

SW_BODY="$(curl -s -m 15 -H 'Cache-Control: no-cache' "${SITE}/sw.js?v=${BUILD_VERSION}" || true)"
case "${SW_BODY}" in
  *"${BUILD_VERSION}"*) echo "  sw.js: 缓存版本 ${BUILD_VERSION} 已生效" ;;
  *) echo "  !! sw.js 线上未读到版本 ${BUILD_VERSION}，老用户可能仍被旧缓存钉住，请复查" >&2 ;;
esac

# sw.js 必须是 no-cache（或 max-age=0），否则浏览器会拿 HTTP 缓存里的旧 sw.js 去比对，
# 永远发现不了新版本。页面侧 register 已带 updateViaCache:'none' 兜底，但服务端头正确才是根治。
SW_HEAD="$(curl -sI -m 15 "${SITE}/sw.js" || true)"
SW_CC="$(printf '%s' "${SW_HEAD}" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}' || true)"
case "${SW_CC}" in
  *no-cache*|*no-store*|*max-age=0*) echo "  sw.js Cache-Control: ${SW_CC}（正确）" ;;
  "") echo "  !! sw.js 未返回 Cache-Control。建议 nginx 加：location = /sw.js { add_header Cache-Control \"no-cache\"; }" >&2 ;;
  *)  echo "  !! sw.js Cache-Control 为 '${SW_CC}'，会拖慢老用户拿到新版；建议改成 no-cache" >&2 ;;
esac

for leftover in "ART_SPEC.md" "scripts/deploy.sh" "package-lock.json" "art/preview/before/hero_player.png"; do
  CODE="$(http_code "${SITE}/${leftover}")"
  case "${CODE}" in
    403|404) echo "  ${leftover}: 已下线 (${CODE})" ;;
    *) echo "  !! ${leftover} 仍可访问 (${CODE})，请检查清理步骤" >&2 ;;
  esac
done

echo "==> 部署完成！"
echo "  ${SITE}"

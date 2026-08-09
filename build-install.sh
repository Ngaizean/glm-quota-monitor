#!/bin/bash
# build-install.sh — 编译 + 构建安装包 + 自动覆盖安装到 /Applications
# 用法: ./build-install.sh

set -e

PROJECT_DIR="/Volumes/NZeanData/Users/ngaizean/Desktop/Agent/glm-quota-monitor"
APP_NAME="GLM Quota Monitor"

cd "$PROJECT_DIR"

echo "================================================"
echo "  GLM Quota Monitor — 构建 + 自动安装"
echo "================================================"
echo ""

# 1. 退出正在运行的旧版本
echo "[1/6] 退出旧版本..."
OLD_PID=$(pgrep -f "/Applications/$APP_NAME.app/Contents/MacOS" 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  kill $OLD_PID 2>/dev/null || true
  sleep 2
  echo "  ✓ 已退出 PID $OLD_PID"
else
  echo "  · 无运行实例"
fi

# 2. 前端构建
echo ""
echo "[2/6] 构建前端 (tsc + vite)..."
npm run build
echo "  ✓ 前端构建完成"

# 3. 强制重新嵌入前端资源
#    Tauri 通过 build.rs 在编译时嵌入 dist，但 cargo 缓存可能导致旧 dist 被复用。
#    touch build.rs + 删除主 crate 缓存，强制重新编译并嵌入最新 dist。
echo ""
echo "[3/6] 强制刷新前端嵌入缓存..."
touch src-tauri/build.rs
rm -f src-tauri/target/release/glm-quota-monitor
rm -f src-tauri/target/release/libglm_quota_monitor.rlib
find src-tauri/target/release/.fingerprint -name "*glm_quota_monitor*" -type d -exec rm -rf {} + 2>/dev/null || true
echo "  ✓ 缓存已刷新"

# 4. Tauri 构建 (release)
APP_BUNDLE="$PROJECT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
echo ""
echo "[4/6] 构建 Tauri 应用 (release)..."
# 先清除精确的旧产物，确保构建失败时绝不会误装陈旧应用。
rm -rf "$APP_BUNDLE"
# 本地安装关闭 updater 产物，不依赖正式发布使用的签名私钥。
npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
if [ ! -d "$APP_BUNDLE" ]; then
  echo "  ✗ 错误: .app 未生成，构建失败"
  exit 1
fi
echo "  ✓ Tauri 构建完成"

# 5. 验证前端已嵌入 + 本地临时签名 + 清除隔离属性
echo ""
echo "[5/6] 验证 + 清除隔离属性..."
# 用嵌入后 index.html 里的 `/assets/index-*` 引用判断前端是否已嵌入二进制。
# （旧标记 groupGlm 是早期 CSS 类名，重构后已不存在；直接 grep 二进制对 NUL 字节处理不可靠，
#  故用 strings 提取可打印串再匹配。assets/index- 不依赖具体 hash，跨构建稳定。）
EMBEDDED=$(strings "$APP_BUNDLE/Contents/MacOS/glm-quota-monitor" | grep -c "assets/index-" || true)
if [ "$EMBEDDED" -eq 0 ]; then
  echo "  ⚠ 警告: 前端可能未正确嵌入"
else
  echo "  ✓ 前端已正确嵌入 ($EMBEDDED 处标记)"
fi
xattr -cr "$APP_BUNDLE"
echo "  ✓ 隔离属性已清除"
codesign --force --deep --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"
echo "  ✓ 本地临时签名验证通过"

# 6. 安装 + 启动
INSTALL_PATH="/Applications/$APP_NAME.app"
echo ""
echo "[6/6] 安装到 /Applications..."
rm -rf "$INSTALL_PATH"
cp -R "$APP_BUNDLE" "$INSTALL_PATH"
xattr -cr "$INSTALL_PATH"
echo "  ✓ 安装完成"

echo ""
echo "================================================"
echo "  ✓ 全部完成！正在启动..."
echo "================================================"
open -a "$INSTALL_PATH"
echo ""
echo "应用已在菜单栏启动。"

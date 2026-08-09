# GLM Quota Monitor

一款跨平台桌面工具，专注智谱 GLM Coding Plan 的额度管理、用量统计、多账号管理和智能预警。

## 开发

```bash
npm install
npm run dev
npm run test:run
npm run build
```

前端采用 React、TypeScript 与 Tauri。通用界面原语位于 `src/components/ui/`，领域逻辑集中在 `src/lib/` 与各功能目录的 controller/hook 中；页面组件只负责组合和展示。开发环境可用 `?preview=1` 预览弹窗，或用 `?preview=settings&pane=theme` 直接预览设置页。

## 文档

- [产品需求文档 v1.0](docs/PRD.md)

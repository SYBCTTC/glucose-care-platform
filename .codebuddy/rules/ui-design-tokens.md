---
description: 前端视觉与样式强制规范（设计令牌、语义色、暗色与字号档）。任何前端页面/组件改动必读。
globs: apps/web/**
---

# 前端视觉与样式规范（强制）

取值来源：`docs/UI-DESIGN-TOKENS.md`（v1 已生效）。代码落地在：

| 文件 | 职责 |
|---|---|
| `apps/web/src/styles/tokens.ts` | 设计令牌 + Antd `ThemeConfig` + 语义色常量 + 血糖区间判定 |
| `apps/web/src/styles/global.css` | `--gc-*` CSS 变量、基础重置、语义色类、打印样式 |
| `apps/web/src/styles/chartTheme.ts` | ECharts 配色、阈值线、目标范围带 |
| `apps/web/src/store/theme.ts` | 明/暗模式与字号档（localStorage 持久化） |

## 硬规则（违反必须返工）

1. **禁止硬编码色值**：页面/组件内不得出现 `#xxx`、`rgb()`；用 Antd token、CSS 变量或 `styles/tokens.ts` 常量。
2. **语义色只能引用已登记值**：血糖区间、记录状态、数据来源、设备状态、角色标签的色值来自 `tokens.ts`，不得临时造色。
3. **新增语义色必须先登记**：先改 `docs/UI-DESIGN-TOKENS.md`，再改 `tokens.ts` 与 `global.css`。
4. **主色 `#6ad3d8` 上禁止用白字**：对比度仅 1.76:1。主按钮/主色标签文字统一用 `brandColor.primaryInk`（`#08333a`，11.9:1）。
5. **状态必须"色 + 文"双通道**：血糖高低除颜色外必须带"低/正常/高"文字或图标，禁止仅靠颜色区分（色弱安全）。
6. **阈值不得硬编码**：低/高阈值来自后端系统配置；未取到阈值时不做区间着色。
7. **数值必须等宽**：血糖值、时间等使用 `className="gc-num"`（`tabular-nums` + 右对齐）。
8. **图表统一走 `chartTheme.ts`**：不得在页面内拼 ECharts color / markLine / markArea。
9. **字号与间距**用 `--gc-font-*` / `--gc-space-*` 或 `layoutSize`，不写魔法数字。
10. **图标只用 `@ant-design/icons`**，禁止引入第二套图标或外链字体（内网无外网）。

## 主题使用方式

- 主题在 `App.tsx` 顶层 `ConfigProvider` 注入（唯一入口），页面不要再包 `ConfigProvider`。
- 取当前模式：`useThemeStore((s) => s.mode)`；切换：`toggleMode()` / `toggleFontScale()`。
- 明暗与字号通过 `<html data-theme data-font>` 驱动 CSS 变量，写入 DOM 已在入口与 store 中处理。

## 页面骨架约定

- 页面根节点加 `className="gc-page"`（最小宽度 1024）。
- 顶栏/侧边栏等打印时隐藏的元素加 `className="gc-no-print"`。
- 卡片间距用 `layoutSize.cardGap`，内容区边距用 `layoutSize.contentPadding`。

---
description: AI 运行效率守则。执行终端命令、代码探索、故障诊断类任务时必读；适用于所有会话，用于避免无效重试与上下文膨胀。
---

# AI 运行效率守则

> 来源：2026-11-19 复盘。一次 WARD_TAB 缓存排查耗时 30+ 分钟，
> 大头浪费在终端输出被截断后的反复重试与迂回诊断上。以下三条为硬性守则。

## 1. 命令受阻两次即换策略
- 同一条终端命令输出被截断、或被安全包装器拦截，累计 **2 次**后禁止再换变体重试
- 立即改走替代通道：
  - 命令结果写入临时文件（`.devtools/` 下，用后删除）→ `read_file` 读取
  - 或直接用内置工具（`read_file` / `search_content` / `search_file`）替代 shell
- 本机已知摩擦点（Windows PowerShell）：
  - 写文件必须显式 `-Encoding utf8`，否则被安全包装器拦截
  - `Remove-Item` 批量删除时若含不存在的路径，Safe-Delete 会整条拦截；只删确认存在的文件
  - dev 服务运行时，复用 shell 的输出可能被 serviceInfo 截断——优先「写文件 + read_file」

## 2. 广度搜索交给 code-explorer 子代理
- 跨多文件 / 多目录 / 多种命名约定的探索，优先派 `code-explorer` 子代理执行
- 子代理的搜索过程不进入主上下文，可显著延缓上下文膨胀
- 派单要求：给足已知信息（路径、符号、已排除项），明确「只回报结论 + 证据路径，不要贴大段文件」
- 主上下文只保留：定点读取、修改、验证

## 3. 先做决定性检查，再展开
- 诊断先问：「哪一个检查能一次性区分最多假设？」先做它，再按结果展开
- 禁止未做决定性检查前逐层读源码「广撒网」
- 本仓典型案例：
  - 共享包导出 undefined / Vite 缓存类问题 → 第一步对比三处 mtime 与关键符号：
    `packages/shared/dist` → `apps/web/node_modules/@gc/shared/dist` → `apps/web/node_modules/.vite/deps`
  - `search_content`（ripgrep）遵循 .gitignore：搜 node_modules 内容会假阴性，
    改用 `Test-Path` / `findstr` / 直接 `read_file`

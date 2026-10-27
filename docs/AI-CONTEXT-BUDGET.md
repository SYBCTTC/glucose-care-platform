# AI 上下文预算管理

> 面向 AI 的操作手册，不是产品文档。
> 目标：在单次会话的上下文窗口内完成更多有效工作，且不因压缩而丢约束。
> 与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准；本文只补充"怎么省上下文"，不定义业务规则。

---

## 1. 上下文快满的真实代价

不是"突然不能用"，而是**准确性先崩，速度后崩**：

| 现象         | 后果                                                          |
| ------------ | ------------------------------------------------------------- |
| 忘记前置约束 | 违反 `assertInScope`、漏掉审计、绕过脱敏                      |
| 重复提问     | 已经确认过的决策被重新问一遍，浪费你的时间                    |
| 触发摘要压缩 | 只在对话里说过、没落盘的信息蒸发；落盘到 `docs/specs/` 的不会 |
| 单轮变慢变贵 | 每轮重新处理全量历史                                          |

**核心结论：真正的风险是"AI 以为自己还记得"。** 对抗手段只有一个——把决策写进文件。

---

## 2. 消耗大头在哪

不是"思考"，是**工具输出**。本仓库实测：

| 来源                               | 量级                                               |
| ---------------------------------- | -------------------------------------------------- |
| 一次 `pnpm test` 全量              | 数百行，含 React `useLayoutEffect` 警告堆栈刷屏    |
| 一次 Prisma 运行期报错             | 上万字符，会把 `library.js` 压缩源码整段打进上下文 |
| `git commit` 的 CRLF 警告          | 每次提交刷一遍                                     |
| 整文件读取 370 行的 service / 组件 | 单次数百行                                         |
| `pnpm -r` 的多包前缀输出           | 每个包每行都带 `apps/xxx test:` 前缀               |

一次"勘察 → 实现 → 验证"的全流程，工具输出常占掉一半以上窗口。

---

## 3. 命令层：成功静默，失败全量

### 3.1 用 `check` 替代裸 `pnpm lint && pnpm typecheck && pnpm test`

```bash
pnpm check          # 全仓库，约 34s，成功只输出 6 行
pnpm check:server   # 只验后端 + shared，约 12s
pnpm check:web      # 只验前端 + shared
```

输出形如：

```
> check [all] 全仓库

✅ lint       11.4s
✅ typecheck   7.9s
✅ test       14.5s  Tests  7 passed (7) | Tests  17 passed (17) | Tests  10 passed (10)

全部通过（总计 33.8s）
```

失败时**不做任何裁剪**，原样打印该步骤完整输出并以非零码退出——诊断信息一个字都不少。

`⚠️` 注意 `--passWithNoTests` 会让"一个用例都没跑"也算通过，所以摘要行必须看：出现 `未发现用例统计` 说明这个包实际没有测试。

### 3.2 改代码期间只跑受影响的包

```bash
pnpm check:server                                                    # 12s
pnpm --filter @gc/server exec vitest run src/common/data-scope       # 按目录
pnpm --filter @gc/web exec vitest run permission-route               # 按名称片段
```

全量 `pnpm check` 只在**准备提交前**跑一次。

### 3.3 输出收敛的通用写法

| 场景      | 不要用                | 用                                                             |
| --------- | --------------------- | -------------------------------------------------------------- |
| 看改动量  | `git diff`            | `git --no-pager diff --stat`                                   |
| 看历史    | `git log`             | `git --no-pager log --oneline -10`                             |
| 提交/推送 | `git commit ... 2>&1` | `git commit ... 2>$null`（PowerShell，压掉 CRLF 警告）         |
| 搜代码    | 整文件 `read_file`    | 先 `search_content` 拿行号，再 `read_file` 带 `offset`/`limit` |

`2>&1` 在 PowerShell 下会把 git 的进度信息转成 `NativeCommandError` 长堆栈，不要用。

---

## 4. 读取层：先定位，再精读

1. **先 `search_content`**，拿到 `file:line`，再决定读不读。
2. **`read_file` 必带 `offset` + `limit`**，单次不超过 ~120 行；需要全貌时优先看导出签名而不是实现。
3. **同一文件在一次会话里只读一次**，读到关键行号就记在回复里，后续按行号回读。
4. **大文件用 `code-explorer` 子代理**，它跑完只回结论，正文不进主上下文。

反例：编辑患者那轮，勘察阶段读了 10+ 个文件（列表页、弹窗、schema、service、controller、crypto、三个规则文件），那一段就吃掉了可观的窗口。

---

## 5. 检索层：先文档，后代码

按成本从低到高，逐级下沉，**能用上一级就不要动下一级**：

```
git log --oneline -10          ← 最便宜：历史决策
docs/specs/*.md                ← 接口契约、已确认决策、验证记录
docs/*.md                      ← 架构、权限、错误码、UI 令牌
AGENTS.md + .codebuddy/rules/  ← 强制规则
代码                            ← 最贵，最后才读
```

`docs/specs/patient-update.md` 里记着 Q1–Q9 的决策表和端到端验证结果——新窗口读它比读 `patient.service.ts` 便宜十倍，信息还更准。

---

## 6. 会话切分：设计与实现分开

勘察阶段最贵（要读一堆文件），而它的产出（spec）恰好是下一阶段的全部输入。

```
会话 A：需求 → 勘察 → 出 spec + 改动清单 + 待确认点 → 提交 spec
会话 B：读 spec → 实现 → check → 提交代码
会话 C：联调 / 视觉验收 / 补漏
```

会话 B 的上下文占用约为 A 的三分之一。

**切换点选在"文件已落盘"之后。** 没提交就换窗口，新窗口读不到；`handoff` skill 只会生成摘要文档，不会替你搬运未落盘的改动。

---

## 7. 新会话开场模板

不要一上来就描述需求，先给锚点：

```text
先读 AGENTS.md、docs/specs/patient-update.md，
以及 .codebuddy/rules/permissions.md 和 security-and-audit.md。

背景：<一句话>
本次只做：<一个原子任务>
本次不做：<明确边界>

改完跑 pnpm check:server，通过后再跑一次全量 pnpm check。
```

三段式（背景 / 只做 / 不做）能显著减少来回澄清，也防止 AI 顺手扩大改动范围。

---

## 8. 反模式清单

- ❌ 一个会话里连续做 3 个不相关任务
- ❌ 让 AI "自己找找相关代码"，而不是用 `@文件` / `@目录` 指定
- ❌ 反复整文件读取同一个大文件
- ❌ 跑全量 `pnpm test` 看单个改动是否有问题
- ❌ 只把约束说在对话里，不写进 spec（压缩后必丢）
- ❌ 依赖"AI 还记得上次确认过的方案"——它不记得
- ❌ 上下文已经很满还继续加需求，正确做法是先落盘再开新窗

---

## 9. 命令速查

```bash
# 质量门禁
pnpm check                 # 全量，提交前跑
pnpm check:server          # 改后端时
pnpm check:web             # 改前端时

# 单点验证
pnpm --filter @gc/server typecheck
pnpm --filter @gc/web  typecheck
pnpm --filter @gc/server exec vitest run src/common/data-scope/scope.util.spec.ts
pnpm --filter @gc/web  exec vitest run routes.spec.tsx

# 共享包改动（改完必做，漏了会白屏）
pnpm sync:shared
# 然后清 apps/web/node_modules/.vite

# 历史与差异
git --no-pager log --oneline -10
git --no-pager diff --stat
```

---

## 10. 自查（每完成一个阶段问自己）

1. 这一阶段的结论**落盘**了吗？没落盘 = 下个会话不存在。
2. 跑的是最小必要范围吗？还是又跑了全量?
3. 这次会话里有几个任务？超过 1 个就该拆。
4. 有没有反复读同一个文件？

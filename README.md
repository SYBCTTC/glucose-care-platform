# 血糖数据与设备管理平台（gc）

医护端 Web 系统：患者血糖数据查看、手工录入、血糖仪设备管理。
规模：医护账号 < 2000；部署：医院内网；后端 NestJS；数据库 PostgreSQL。
当前数据来源：**医护手工录入**；已为 CGM 与设备自动上传预留扩展点。

---

## 一、环境要求

| 项目 | 要求 | 说明 |
|---|---|---|
| Node.js | **推荐 20.x / 22.x LTS**（当前开发机 v21.7.2 可用） | 奇数版本（21）为非 LTS 且已停止维护，**禁止用于生产环境**；等保要求运行时具备安全更新能力 |
| pnpm | 9.x（`npm i -g pnpm@9.14.4`） | monorepo 依赖 |
| Docker | 20+（**可选**） | 有则用 `docker compose` 起 PostgreSQL；无 Docker 时用 `.devtools` 嵌入式 PG |
| PostgreSQL | 16 | docker-compose 或 `.devtools/start-db.mjs` 提供 |

> **Node 版本**：开发机 v21.7.2 可用，但 21 是奇数版（非 LTS、已停止维护），
> **禁止用于生产环境**。推荐 20.x / 22.x LTS，仓库已通过 `.nvmrc` 固定为 `20.18.0`。

## 二、初始化

```bash
# 1) 安装依赖
pnpm install

# 2) 准备环境变量
cp .env.example .env
#   本地开发默认值可直接用；生产环境密钥由运维注入，禁止入库

# 3) 启动数据库（二选一）
docker compose up -d postgres redis          # 有 Docker
node .devtools/start-db.mjs                  # 无 Docker：嵌入式 PG 16，端口 5432

# 4) 建库并灌入脱敏演示数据
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5) 首次启动前先构建共享包（之后由 pnpm dev 的 watch 自动增量编译）
pnpm --filter @gc/shared build

# 6) 启动前后端（默认 web:5173 / server:3000）
pnpm dev
```

演示账号（密码统一 `Gc@2026pass`）：

| 账号 | 角色 | 科室 | 用途 |
|---|---|---|---|
| `dr.wang` | 医生 | 内分泌科 | 主流程 |
| `nurse.li` | 护士 | 内分泌科 | 手工录入 |
| `head.zhou` | 护士长 | 内分泌科 | 患者管理 + 审计 |
| `dr.chen` | 医生 | 心内科 | 验证**跨科室越权被拒** |

> **首次登录会强制修改密码**（`User.mustChangePassword`）：除改密、登出、查看个人信息外的接口一律返回 `20005`。
> 密码规则：8–64 位，小写/大写/数字/符号四类至少含三项，且不能包含用户名或姓名（实现见 `packages/shared/src/auth/password.ts`）。
> 演示状态可随时用 `pnpm db:seed` 重置（统一密码 `Gc@2026pass` + 恢复"未改密"）。

## 三、目录说明

```
apps/web     前端：Vite + React 18 + Ant Design 5 + ECharts
apps/server  后端：NestJS + Prisma（模块：auth / health / glucose）
packages/shared 前后端共享：Zod 契约、血糖单位换算、角色权限字典
docs/        架构与合规文档
.codebuddy/rules  给 AI 的领域规则（按文件路径自动加载）
AGENTS.md    给 AI 的总纲，任何代码生成前必读
```

## 四、开发流程（AI 协作）

1. 先更新契约：`packages/shared` 的 Zod schema、Prisma schema、接口定义
2. 再让 AI 按单个原子任务实现（一个接口 / 一个页面）
3. 提交前必须过：`pnpm lint && pnpm typecheck && pnpm test`
4. **以下改动禁止交给 AI 自行决定**：Prisma migration、鉴权、数据权限过滤、审计、CI/部署配置、依赖新增
5. 涉及患者数据、权限、审计的改动，必须人工逐行评审

## 五、CGM 扩展路径

| 阶段 | 动作 |
|---|---|
| 现在（BGM） | 单表 + 索引即可，数据入口 `GlucoseService.createManualRecord` |
| 启用 CGM 时 | 1) 新增 adapter 走 `GlucoseIngestionService` 统一入口<br>2) `kind = CGM`，扩展字段写 `rawPayload`<br>3) 启用 `GlucoseDailySummary` 的 TIR/CV 指标<br>4) 单表 > 5000 万行时执行 `apps/server/prisma/sql/glucose_record_partition.sql` 做按月分区 |

## 六、内网交付注意事项

- 内网无外网：依赖需通过私服或 `pnpm store` 离线包安装；镜像用 `docker save` 导入
- 前端构建产物禁止引用任何公网 CDN（字体、图标、组件库全部本地打包）
- 服务器需配置 **NTP 时间同步**（血糖测量时间对业务准确性至关重要）
- 交付前完成 `docs/COMPLIANCE-CHECKLIST.md` 自查

## 七、本机环境已知问题与处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `pnpm install` 报 `Cannot find module '@prisma/debug'` | pnpm 隔离式 node_modules 下 Prisma postinstall 异常 | `.npmrc` 已设 `node-linker=hoisted` |
| `prisma migrate/diff` 执行后卡住无输出 | Prisma CLI 在部分 Windows 终端下等待 stdin | 命令后加 `< NUL`，例如 `pnpm exec prisma migrate dev --name x < NUL` |
| Prisma 提示引擎版本 undefined 并重新下载（内网极慢） | 手动放置的引擎无版本标记 | 在 `.env` 设置 `PRISMA_QUERY_ENGINE_LIBRARY` / `PRISMA_SCHEMA_ENGINE_BINARY` 指向本地引擎 |
| 运行报 `Cannot find module '@gc/shared'` | 无管理员权限时 workspace junction 不可遍历 | 执行 `pnpm sync:shared`（复制共享包产物到各应用 node_modules） |
| `nest build` 后 dist 缺文件 | `incremental` 依据 tsbuildinfo 跳过产出 | 构建配置已关闭增量；必要时删除 `*.tsbuildinfo` 后重跑 |

## 八、开发计划（P0–P6）

**唯一权威路线图：`docs/ROADMAP.md`**（阶段划分、验收标准、当前进度与非代码待办事项）。
本节原有的 P0/P1/P2 编号已废弃并并入该文档，避免两套编号冲突。

| 阶段 | 主题 | 进度 |
|---|---|---|
| P0 | 工程底座与规范 | 100% |
| P1 | 认证与会话 | 92% |
| P2 | 权限体系（功能 + 数据） | 60% |
| P3 | 血糖核心业务（BGM） | 85% |
| P4 | 患者管理 | 0% |
| P5 | 设备管理与导出 | 0% |
| P6 | 审计、系统管理与生产交付 | 8% |

引用方式：提交说明或需求描述中写阶段号，例如 `P4-患者建档`、`P2-前端路由守卫`。

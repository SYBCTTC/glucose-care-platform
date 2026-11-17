# 服务端错误码规范（v1 · 已生效）

> **状态：已确认并落地（F 节未填项按推荐值执行）。**
>
> 落地位置：
> - `packages/shared/src/error/codes.ts` —— 码表 + `ERROR_CODE_META`（HTTP 状态/默认中文/前端策略），前后端共用
> - `apps/server/src/common/exceptions/business.exception.ts` —— `BusinessException`
> - `apps/server/src/common/filters/http-exception.filter.ts` —— 错误码映射 + requestId + 5xx 屏蔽
> - `apps/server/src/common/middleware/request-id.middleware.ts` —— `X-Request-Id`
> - `apps/web/src/api/client.ts` + `apps/web/src/api/error-handler.ts` —— 请求拦截器按策略表分派
> - `.codebuddy/rules/error-codes.md` —— AI 强制规则
>
> 实测（2026-10-21）：登录失败 `20001`、未登录 `20002`、参数校验 `10001+details`、患者不存在 `40001`、跨科室 `30002`，成功与失败响应均带 `requestId`。

---

## A. 现状与必须解决的问题

现状：响应体 `{ code, message, data }`，**失败时 `code` 直接等于 HTTP 状态码**（`HttpExceptionFilter` 中 `code: status`）。

| # | 问题 | 后果 |
|---|---|---|
| 1 | **粒度太粗**：403 既是"无权限点"、又是"跨科室越权"、还是"账号已停用" | 前端只能弹通用文案；等保审计难以按类型统计 |
| 2 | **登录失败与登录态失效都是 401** | 现有前端拦截器对所有 401 执行"清 token + 跳登录 + 提示已失效"，导致**密码输错时弹出"登录状态已失效，请重新登录"**（现存缺陷，必须靠错误码拆开） |
| 3 | **无法聚合监控** | 5xx 不知道是数据库、审计写入还是厂商接口故障 |

**结论**：`code` 改为独立业务码，HTTP 状态码仍保持语义正确（满足 REST 与等保要求），前端按 `code` 分派处理。

---

## B. 响应体规范（v2）

```jsonc
{
  "code": 30002,                 // 业务错误码，0 = 成功
  "message": "无权访问其他科室的患者数据",  // 可直接展示的中文
  "data": null,                  // 成功为业务数据；失败默认 null
  "details": [                   // 可选：字段级错误（校验类）
    { "field": "valueMmolL", "message": "血糖值必须在 1~40 mmol/L 之间" }
  ],
  "requestId": "9f2c1a7e-...",   // 建议新增
  "timestamp": "2026-10-21T00:00:00.000Z"  // 建议新增
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `code` | 是 | `0` 成功；非 0 见 D 节 |
| `message` | 是 | 面向医护的简体中文，禁止暴露堆栈/SQL |
| `data` | 是 | 成功时业务数据 |
| `details` | 否 | 仅校验类错误使用，`{ field, message }[]`（现有 Zod 管道已产出此结构，可直接复用） |
| `requestId` | 是 | 与服务端日志/审计一一对应，5xx 时前端展示给用户报修 |
| `timestamp` | 是 | 便于排查服务器时间是否正确 |

---

## C. 码段规划（5 位数，便于按段位聚合监控）

| 段位 | 含义 | 归属 | 审计要求 |
|---|---|---|---|
| `0` | 成功 | 通用 | — |
| `1xxxx` | 通用错误（参数、校验、资源、并发） | 通用层 | 4xx 不记 |
| `2xxxx` | 认证与会话 | 认证模块 | 全部记 |
| `3xxxx` | 授权与**数据权限**（跨科室/患者归属） | 权限模块 | **全部记（等保重点）** |
| `4xxxx` | 患者业务 | patient | 写操作记 |
| `42xxx` | 设备业务 | device | 写操作记 |
| `43xxx` | 用户与角色 | user/role | 全部记 |
| `5xxxx` | 系统与依赖故障 | 平台 | 全部记（含堆栈） |
| `9xxxx` | 厂商/设备平台接入（预留） | integration | 全部记 |

---

## D. 错误码清单（推荐值，可改）

### D1. 通用 `1xxxx`

| code | HTTP | message（前端直接展示） | 触发场景 | 前端处理 |
|---|---|---|---|---|
| 10000 | 500 | 服务器内部错误 | 未捕获异常 | 兜底文案 + requestId |
| 10001 | 422 | 参数校验失败 | Zod 校验不通过 | **映射到表单字段**，不弹全局 toast |
| 10002 | 400 | 缺少必填参数 | body/query 缺字段 | toast |
| 10003 | 400 | 参数格式不正确 | 类型/日期/枚举非法 | toast |
| 10004 | 400 | 请求体格式错误 | JSON 解析失败 | toast |
| 10005 | 404 | 请求的资源不存在 | 路由/资源不存在 | toast |
| 10006 | 400 | 分页参数不合法 | page < 1 或 pageSize > 100 | toast |
| 10007 | 504 | 请求超时，请稍后重试 | 网关/数据库超时 | toast，允许重试 |
| 10008 | 409 | 数据正在被其他用户修改，请刷新后重试 | 乐观锁失败 | toast + 刷新列表 |
| 10009 | 400 | 不支持的文件格式 | 导出格式非法 | toast |
| 10010 | 405 | 请求方法不被支持 | — | toast |
| 10011 | 503 | 系统维护中，请稍后再试 | 维护窗口 | 全屏提示 |

### D2. 认证与会话 `2xxxx`

| code | HTTP | message | 触发场景 | 前端处理 |
|---|---|---|---|---|
| 20001 | 401 | 用户名或密码错误 | 登录校验失败 | **登录页字段级报错，不跳登录** |
| 20002 | 401 | 登录状态已失效，请重新登录 | token 过期/非法 | **清 token + 跳登录页** |
| 20003 | 423 | 密码错误次数过多，账号已锁定 | 连续失败达阈值 | 登录页展示锁定时长与解锁时间 |
| 20004 | 403 | 账号已被停用，请联系系统管理员 | `user.status != ACTIVE` | toast，不跳登录但禁止操作 |
| 20005 | 403 | 首次登录请先修改密码 | 强制改密期间访问其他接口（`MustChangePasswordGuard`） | 弹出不可关闭的改密框，不 toast |
| 20006 | 422 | 新密码不符合强度要求 | 需服务端上下文的校验（如包含用户名/姓名） | 表单字段级报错 |
| 20007 | 422 | 当前密码不正确 | 改密校验 | 表单字段级报错 |
| 20008 | 401 | 账号已在其他终端登录 | 会话互斥 | 清 token + 跳登录 |
| 20009 | 422 | 新密码不能与当前密码相同 | 改密时新旧密码一致 | 表单字段级报错 |

> 密码的**长度与字符类别**（四类取三）由 Zod 在控制器前校验，返回 `10001` + `details`；
> 需上下文的判断（是否包含用户名、是否与旧密码相同）才用 `20006` / `20009`。

> 现有代码锁定用的是 **429**，推荐改为 **423 Locked**（语义更准，429 留给限流），也可保留 429 —— 请在 F 节确认。

### D3. 授权与数据权限 `3xxxx`（等保重点，全部记审计）

| code | HTTP | message | 触发场景 | 前端处理 |
|---|---|---|---|---|
| 30001 | 403 | 当前账号无权访问该资源 | 通用无权兜底（未归类的 403） | toast，不跳转 |
| 30002 | 403 | 无权访问其他科室的患者数据 | 跨科室查询/操作 | toast，提示"如需查看请联系科室管理员" |
| 30003 | 403 | 该患者已归档，禁止操作 | 患者归档后写入 | toast |
| 30004 | 403 | 当前账号缺少所需权限点 | `PermissionsGuard` 拦截（精确到权限点） | toast |
| 30005 | 403 | 该设备未绑定此患者 | 设备归属越权（设备属于其他患者） | toast |
| 30006 | 403 | 当前角色无权访问患者数据 | 数据范围 `NONE`（如设备管理员）访问患者/血糖 | toast |

### D4. 患者 `4xxxx`

| code | HTTP | message | 触发场景 |
|---|---|---|---|
| 40001 | 404 | 患者不存在或已归档 | 现有实现，建议保留 |
| 40002 | 409 | 住院号已存在 | `patientNo` 唯一冲突 |
| 40003 | 409 | 该患者已绑定有效设备 | 重复绑定 |
| 40004 | 409 | 患者当前状态不允许该操作 | 状态机校验 |

### D5. 血糖 `41xxx`（挂在患者下）

> 血糖业务已重建，但**不再是独立模块**：路由挂在患者下（`POST /patients/:id/glucose`），
> 权限点 `glucose:create`（`PERMISSION.GLUCOSE_CREATE`），审计动作 `GLUCOSE_CREATE`，
> 与患者模块共用同一套鉴权、数据范围（`RESOURCE.PATIENT`）与审计口径。
> 2026-10-22 那次「整体移除」的说明**已作废**：`GlucoseRecord` 表、`glucose` 模块、
> `GLUCOSE_CREATE` 权限点均已存在，`41xxx` 号段仍归血糖域。
> 原 `GLUCOSE_VIEW` / `GLUCOSE_INPUT` / `GLUCOSE_EXPORT` 三个权限点未恢复，
> 它们作为 `AuditAction` 的**历史枚举值**保留在 schema 里（旧审计行仍在引用，见 `DB-MIGRATION-NOTES.md` §2.3）。

#### 当前已实现的错误场景（**均复用既有码，不占用 `41xxx`**）

| 场景 | 错误码 | HTTP | 前端行为 |
|---|---|---|---|
| 患者不存在**或已归档** | `40001 PATIENT_NOT_FOUND` | 404 | toast |
| 患者非住院（出院/待入院） | `40004 PATIENT_INVALID_STATE` | 409 | toast |
| 跨科室患者 | `30002 CROSS_DEPARTMENT_DENIED` | 403 | toast |
| 数据范围为 NONE（设备管理员） | `30006 NO_PATIENT_DATA_SCOPE` | 403 | toast |
| 缺 `glucose:create` 权限点 | `30004 MISSING_PERMISSION` | 403 | toast |
| 血糖值/试纸/记录者/检测时间不合法 | `10001 VALIDATION_FAILED` | 422 | 字段级 |
| 检测时段在库里不存在 | `10001` + `details[{field:'mealContext', message:'检测时段不存在'}]` | 422 | 字段级 |
| 检测时段已停用 | `10001` + `details[{field:'mealContext', message:'检测时段已停用'}]` | 422 | 字段级 |
| 记录者不存在或已停用 | `10001` + `details[{field:'operatorId'}]` | 422 | 字段级 |
| 同患者同检测时间重复提交 | **不是错误**：`code 0` + `data.skipped=true` | 200 | warning「未重复保存」 |

> 血糖值越界（超出 `0.6 ~ 33.3 mmol/L`）由 `createGlucoseSchema` 拒为 `10001`，**不入库、无复核流程**：
> `GlucoseRecord` 没有 `status` 字段，`PENDING_REVIEW` 未实现。
> 重复提交靠唯一约束 `(patientId, measuredAt)` 幂等跳过，**不得**为它新增错误码（见本文件 §8 约定）。

#### `41xxx` 预留（规划中，**尚未登记进 `codes.ts`**）

| code | 名称 | HTTP | 语义 | 前置条件 |
|---|---|---|---|---|
| 41002 | `GLUCOSE_ALREADY_REVIEWED` | 409 | 异常值已被他人复核（并发冲突） | 需先给 `GlucoseRecord` 加状态字段，走 schema 评审 |
| 41006 | 待定 | 409 | 血糖域冲突类（§E 曾把它归入 409 类，具体语义无历史记录） | 语义待对应功能立项时定义 |
| 41008 | `GLUCOSE_EXPORT_RUNNING` | 409 | 已有导出任务进行中 | 依赖 P5 导出（异步任务 + 水印 + 审批留痕） |

> `41001`、`41003~41005`、`41007`、`41009+` 为血糖域保留号段，语义待对应功能立项时定义。
>
> ⚠️ **实现某项功能时再登记对应错误码**（先改本表，再改 `packages/shared/src/error/codes.ts`），
> 不要提前把未使用的码写进码表：2026-10-22 移除旧血糖模块时，为规划功能预建的
> `EntryChannel` / `GlucoseKind` / `GlucoseUnit` / `MealContext` / `RecordStatus` 五个枚举
> 在库里残留了近一个月，直到 2026-11-17 才清理（见 `docs/DB-MIGRATION-NOTES.md` §2）。

### D6. 设备 `42xxx`

| code | HTTP | message | 触发场景 |
|---|---|---|---|
| 42001 | 404 | 设备序列号不存在 | 查不到台账 |
| 42002 | 409 | 设备序列号已存在 | SN 唯一冲突 |
| 42003 | 409 | 该设备已绑定其他患者 | 绑定冲突 |
| 42004 | 409 | 设备当前状态不允许该操作 | 故障/报废状态 |
| 42005 | 409 | 设备校准已过期，请先校准 | 校准有效期校验 |
| 42006 | 409 | 该设备未绑定患者 | 需先绑定 |
| 42007 | 502 | 设备厂商平台调用失败 | 第三方接口异常 |
| 42008 | 502 | 厂商返回数据格式异常 | 上报数据不合契约 |

### D7. 用户与角色 `43xxx`

| code | HTTP | message | 触发场景 |
|---|---|---|---|
| 43001 | 404 | 用户不存在 | — |
| 43002 | 409 | 用户名已存在 | 唯一冲突 |
| 43003 | 409 | 不能停用/删除最后一个系统管理员 | 保护性约束 |
| 43004 | 409 | 不能修改自己的角色 | 防自锁 |

### D8. 系统与依赖 `5xxxx`（对外不暴露细节）

| code | HTTP | message | 触发场景 | 前端处理 |
|---|---|---|---|---|
| ~~50000~~ | 500 | ~~服务器内部错误~~ | **与 10000 同义，已弃用**：统一兜底用 `10000`，避免同义双码 | 兜底 + requestId |
| 50001 | 503 | 数据库服务不可用 | 连接失败 | 稍后重试 |
| 50002 | 500 | 数据写入冲突 | 唯一约束/并发写 | 刷新重试 |
| 50003 | 503 | 依赖服务暂时不可用 | 内部服务 | 稍后重试 |
| 50004 | 500 | 操作已提交但日志记录异常 | 审计写入失败 | 提示联系信息科，**必须展示 requestId** |
| 50005 | 500 | 数据处理失败 | 加解密/序列化异常 | 兜底 |

### D9. 厂商接入 `9xxxx`（预留）

| code | HTTP | message | 触发场景 |
|---|---|---|---|
| 90001 | 502 | 厂商平台认证失败 | token 失效 |
| 90002 | 504 | 厂商平台响应超时 | 上游超时 |
| 90003 | 422 | 上报数据不符合接口约定 | 厂商推送校验失败 |

---

## E. 前端请求拦截器处理策略（`apps/web/src/api/client.ts`）

拦截器按 `code` 分派（`code === 0` 才算成功）：

| 错误码 | 判定方式 | 前端行为 |
|---|---|---|
| `0` | 成功 | 返回 `data` |
| `0` + `data.skipped === true` | 成功但**未写入**（幂等跳过） | `message.warning('未重复保存')`，**不得提示成功**（血糖录入唯一约束命中） |
| `10001` + `details` | 有字段明细 | 映射到对应表单项 `error`；不弹全局 toast |
| `20001 / 20006 / 20007 / 20009` | 登录/改密表单 | **字段级错误提示，不清 token、不跳登录** |
| `20002 / 20008` | 会话失效 | 清 token → 跳 `/login` → `message.error`；并发请求用"单次跳转"去重 |
| `20003` | 账号锁定 | 登录页展示锁定时长，禁用提交按钮 |
| `20004 / 30001~30005` | 权限类 | `message.warning`，**不跳登录、不弹多次** |
| `409` 类（10008/42002~42006/43002~43004；`41006`/`41008` **规划中未实现**） | 冲突 | `message.warning` + 刷新列表 |
| `41002`（**规划中未实现**，见 §D5） | 成功但待复核 | `message.warning('数值异常，已标记待复核')` |
| `423 / 429` | 锁定/限流 | 提示剩余时间，按钮禁用至倒计时结束 |
| `5xxxx` | 系统故障 | 统一"系统繁忙，请稍后重试"；有 requestId 则一并展示"如持续失败请联系信息科并提供编号 xxx" |
| `fetch TypeError` | 网络不可达 | "无法连接服务器，请检查网络或内网环境" |
| `AbortError` | 取消/超时 | **静默**，不打扰用户 |

**其他约定（建议）**
1. 同一时刻多次失败只弹一个 toast（按 code 去重，2s 内合并）。
2. 401 跳登录必须带 `redirect` 参数，登录成功后回原页面。
3. 错误提示中禁止拼接后端堆栈、SQL、设备 SN 等敏感信息。
4. 5xx 必须打前端埋点 `console.error`，带上 `requestId`。

---

## F. 确认状态（2026-11-17 按实际代码回填）

> 原表 12 项的「你的决定」一直空着，但其中 9 项**已被实现事实决定**。此处按代码回填，避免下一轮开发继承错误上下文。

### F.1 已决（有代码依据）

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 响应体 `requestId` | ✅ 已新增 | `RequestIdMiddleware` 生成 UUID 并写 `X-Request-Id` 响应头；`ResponseInterceptor` 补进成功响应，`HttpExceptionFilter` 补进错误响应 |
| 2 | 响应体 `timestamp` | ✅ 已新增 | 同上两处，格式走 `formatDateTime` |
| 3 | 账号锁定用 423 | ✅ 按推荐 | `codes.ts`：`ACCOUNT_LOCKED(20003)` → `httpStatus: 423, action: 'lock'`；429 仍留给限流 |
| 4 | `message` 由服务端给 | ✅ 按推荐 | 服务端 `errorMeta(code).message` 给中文兜底；前端按 `action` 字段分派交互（`field`/`toast`/`relogin`/`lock`…），不自行拼文案 |
| 5 | 校验错误 `details` 结构 | ✅ `{ field, message }[]` | Zod 管道产出；时段校验失败即返回 `details:[{field:'mealContext'}]` |
| 6 | 业务子码 | ✅ 按推荐未引入 | 字段级 `details` 已够用 |
| 7 | 幂等重复提交 | ✅ `200 + skipped: true` | 唯一约束命中 P2002 时幂等跳过；`skipped` 已入审计白名单（提交 `629b16c`） |
| 9 | 5xx 屏蔽真实原因 | ✅ 按推荐 | `HttpExceptionFilter` 对 5xx 覆写 `message = errorMeta(code).message`，只留 `requestId` |
| 11 | 双语 | ✅ 按推荐仅中文 | 内网单语言 |

### F.2 仍未决（新一轮开发前建议先定）

| # | 项 | 现状 | 建议 |
|---|---|---|---|
| 8 | 接口级限流码 | `codes.ts` 无 `RATE_LIMITED`（`10007` 是 `REQUEST_TIMEOUT`，语义不同） | 内网 < 2000 账号，暂不需要；若做导出/批量导入再登记 `10011` |
| 10 | **错误码写入审计独立字段** | ❌ 未实现，且缺口比原判断大：`AuditLogInterceptor` 用 `error instanceof ForbiddenException` 判 `DENIED`，但**全仓无任何守卫/service 抛 `ForbiddenException`**（一律 `BusinessException`）。实测审计表 `SUCCESS 209 / FAILED 44 / DENIED 1`，**越权事件全部记为 `FAILED`**；`detail` 只有固定串 `error:'denied_or_failed'`，不含错误码 → **无法从审计表筛出越权尝试**（`AGENTS.md` §5.1 要求越权留痕） | 改为按 `3xxxx` 码段判 `DENIED`，并把 `code` 写进 `detail`（或加独立列，属 schema 变更需评审） |
| 12 | 需补充的业务码 | `41xxx` 血糖号段仅在 §D5 预留，未登记进 `codes.ts` | 实现对应功能时再登记；`41006` 语义无历史记录，需你给出定义 |

> 另一处相关缺口（不属错误码但同源）：审计 `detail.requestId` 存的是 `context.getClass().name`（实测样例 `"AuthController"`），
> **不是** `RequestIdMiddleware` 生成的 UUID，因此审计行无法与服务端日志、用户报障的 `X-Request-Id` 关联。
> 拦截器已持有 `request` 对象，改为 `request.requestId` 即可，属等保可追溯性缺口。

---

## G. 确认后的落地清单

| 层 | 文件 | 内容 |
|---|---|---|
| 共享 | `packages/shared/src/error/codes.ts` | `ERROR_CODES` 常量 + `ErrorCode` 类型 + `ERROR_CODE_META`（HTTP 状态/默认中文/前端策略） |
| 共享 | `packages/shared/src/schema.ts` | `apiResponseSchema` 扩展 `details`/`requestId`/`timestamp` |
| 服务端 | `common/exceptions/business.exception.ts` | `BusinessException(code, message?, details?)` |
| 服务端 | `common/filters/http-exception.filter.ts` | 从异常取业务码，生成 requestId，5xx 屏蔽细节 |
| 服务端 | 各模块 service | 现有 `throw new XxxException('...')` 替换为业务码 |
| 前端 | `api/client.ts` | 拦截器按 E 节策略表分派；401 单次跳转；toast 去重 |
| 前端 | `api/error-handler.ts` | 错误码 → UI 策略映射表（页面可复用） |
| 规则 | `.codebuddy/rules/error-codes.md` | 写入 AI 强制规则，后续开发遵守 |

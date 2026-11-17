---
description: 前后端统一错误码规范。涉及接口错误返回、异常处理、前端请求拦截器的改动必读。
globs: ["apps/server/**", "apps/web/**", "packages/shared/**"]
---

# 统一错误码规范（强制）

规范文档：`docs/ERROR-CODES.md`（已生效）。唯一码表：`packages/shared/src/error/codes.ts`。

> 码表属于共享包，改完后必须走 `.codebuddy/rules/shared-package.md` 的 **build → sync:shared → 清 Vite 缓存** 三步，否则前端拿到旧副本会白屏。

## 硬规则

1. **禁止直接 `throw new BadRequestException('...')` / `UnauthorizedException` / `ForbiddenException` / `NotFoundException`** 表达业务错误；一律 `throw new BusinessException(ERROR_CODES.XXX)`。
2. **新增错误码必须先登记** `docs/ERROR-CODES.md`，再改 `packages/shared/src/error/codes.ts`（`ERROR_CODES` + `ERROR_CODE_META` 必须齐全，TS 会校验完整性）。
3. `code` 是独立业务码，**不等于 HTTP 状态码**；HTTP 状态码仍要保持语义正确（REST）。
4. **message 面向医护**，禁止暴露堆栈、SQL、设备 SN、患者标识。
5. **5xx 一律屏蔽真实原因**，只返回规范文案 + `requestId`（`HttpExceptionFilter` 已处理，不要在 service 里自行拼错误详情）。
6. **校验类错误必须带 `details`**（`{ field, message }[]`），前端才能映射到表单项。
7. `3xxxx`（授权与数据权限）**必须落审计**，等保检查重点。
8. 幂等重复提交**不是错误**，返回 `code: 0` + `data.skipped: true`，不要用错误码表达。

## 服务端写法

```ts
throw new BusinessException(ERROR_CODES.CROSS_DEPARTMENT_DENIED);
throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
// 需要覆盖默认文案时（例如带锁定时长）
throw new BusinessException(ERROR_CODES.ACCOUNT_LOCKED, `账号已锁定 ${minutes} 分钟`);
```

## 前端写法

- 错误由 `apps/web/src/api/client.ts` 拦截器统一交给 `applyErrorStrategy()` 处理，页面**不要**自己弹 toast。
- `action = 'field'`：页面把 `error.details` 映射到表单项（`form.setFields`），不弹全局提示。
- `action = 'relogin'`：拦截器清 token + 跳 `/login?redirect=...`，并发请求只跳一次。
- 需要刷新列表的冲突类错误监听事件：`window.addEventListener(API_REFRESH_EVENT, refetch)`。
- 系统故障提示已自动附带 `requestId` 前 8 位，便于报修。

## 易错点

- **登录失败（20001）与会话失效（20002）都是 401**，必须按 `code` 区分，不能只判断 HTTP 401（否则密码输错会误跳登录）。
- 血糖域（`41xxx`）**目前一个码都没实现**：`packages/shared/src/error/codes.ts`（唯一码表）里没有任何 `41xxx`。
  血糖业务已重建但**挂在患者下**（`POST /patients/:id/glucose`），错误一律复用既有码——
  患者不存在/已归档 `40001`、非住院 `40004`、跨科室 `30002`、时段或记录者不合法 `10001` + 字段级 `details`。
  血糖越界（超出 `0.6 ~ 33.3 mmol/L`）由 `createGlucoseSchema` 拒为 `10001`，**不入库、无 `PENDING_REVIEW` 复核流程**
  （`GlucoseRecord` 没有 `status` 字段）。
- **重复提交不是错误**：唯一约束 `(patientId, measuredAt)` 命中时返回 `code 0` + `data.skipped=true`，
  前端提示「未重复保存」；禁止为它新增错误码，也禁止提示成功。
- `41002` / `41006` / `41008` 是 `docs/ERROR-CODES.md` §D5 的**预留号段**，实现对应功能时才登记进码表。
  不要提前写进 `codes.ts`：旧血糖模块为规划功能预建的 5 个枚举在库里残留了近一个月才清理
  （见 `docs/DB-MIGRATION-NOTES.md` §2）。

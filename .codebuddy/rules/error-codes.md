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
- `41002`（血糖值异常待复核）是**成功语义**：`code = 0` + `data.status = 'PENDING_REVIEW'`，前端黄色警示，不要当错误处理。

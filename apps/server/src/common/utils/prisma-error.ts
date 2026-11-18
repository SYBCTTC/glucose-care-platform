import { Prisma } from '@prisma/client';

/**
 * 是否 Prisma 唯一约束冲突（P2002）。
 *
 * 为什么需要：应用层的"先查后写"在并发下不安全——两个请求会双双查到"不存在"然后都去写。
 * 库层唯一约束是最终兜底，撞到时必须映射为对应的业务错误码，而不是漏成 50000。
 *
 * 现有三处调用：
 *  - 血糖重复提交（`GlucoseRecord_patientId_measuredAt_key`）→ 幂等跳过，返回 `skipped: true`
 *  - 患者住院号重复（`Patient.patientNo` 唯一）→ 40002 PATIENT_NO_DUPLICATE
 *  - 虚拟病区重复加入（部分唯一索引 `virtual_ward_record_one_active`）→ 44001 WARD_ALREADY_JOINED
 *
 * ⚠️ 判断的是 Prisma 的**字符串**错误码 'P2002'，与响应信封里的数字业务码是两个体系，
 * 不要混用（见 `audit-log.interceptor.ts` 的 `isBusinessCode` 注释）。
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

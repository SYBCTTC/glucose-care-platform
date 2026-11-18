import { z } from 'zod';
import { dateTimeStringSchema } from '../date';
import { WARD_TAB } from '../dict/ward';
import type { PatientListItem } from '../patient/schema';

/**
 * 虚拟病区领域契约（前后端共享）。
 *
 * 安全约定：
 *  1. 出参一律复用患者域的脱敏对象（`PatientListItem`），严禁返回任何 `*Cipher` 列；
 *  2. 数据权限沿用 `RESOURCE.PATIENT`——过滤落在**患者的科室**上，
 *     医生/护士/护士长只见本科室，系统管理员见全院，设备管理员（NONE 档）被拒 30006。
 *     **不新增 RESOURCE、不改 ROLE_DATA_SCOPE、不改 scope.util.ts**。
 *
 * 完整规格：docs/specs/virtual-ward.md
 */

/**
 * 列表查询参数。`tab` 决定主条件、日期条件与排序：
 *  - CURRENT：`leftAt IS NULL`，按 `joinedAt` 区间筛选，`joinedAt desc, id asc`
 *  - HISTORY：`leftAt IS NOT NULL`，按 `leftAt` 区间筛选，`leftAt desc, id asc`
 *
 * 跨 Tab 多传的日期字段由服务端忽略（CURRENT 忽略 leave*，HISTORY 忽略 join*）。
 * 姓名与患者列表同口径：确定性密文**等值**匹配，不支持模糊。
 */
export const wardListQuerySchema = z.object({
  tab: z.nativeEnum(WARD_TAB, { errorMap: () => ({ message: '请指定虚拟病区 Tab' }) }),
  departmentId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  patientNo: z.string().trim().max(32).optional(),
  name: z.string().trim().max(32).optional(),
  bedNo: z.string().trim().max(32).optional(),
  /** 加入时间区间，仅 tab=CURRENT 生效 */
  joinFrom: dateTimeStringSchema.optional(),
  joinTo: dateTimeStringSchema.optional(),
  /** 移出时间区间，仅 tab=HISTORY 生效 */
  leaveFrom: dateTimeStringSchema.optional(),
  leaveTo: dateTimeStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type WardListQuery = z.infer<typeof wardListQuerySchema>;

// 加入 / 移出接口的路径参数直接复用患者域的 `patientIdSchema`（同为 `{ id: uuid }`）。
// 路由参数必须叫 `:id`：AuditLogInterceptor 只从 `params.id` 取审计对象 ID，
// 叫别的名字会让 targetId 恒为空（含越权 DENIED 行），事后无法按患者追溯。

/**
 * 虚拟病区列表项 = 患者列表项 + 本次进出记录。
 *
 * 「加入虚拟病区天数」**由前端计算**，不下发：与「住院天数」现有做法一致
 * （`formatHospitalDays` 在前端按 admissionAt/dischargeAt 算）。
 * 好处是跨零点后无需重新请求即自动 +1，也避免服务端与前端两套口径。
 * 口径：加入当天算 1 天；HISTORY 以 `wardLeftAt` 为终点（曾在区多久，不是至今）。
 */
export interface VirtualWardListItem extends PatientListItem {
  /** 本次进出记录 ID */
  wardRecordId: string;
  /** 加入时间 YYYY-MM-DD HH:mm:ss */
  wardJoinedAt: string;
  /** 移出时间 YYYY-MM-DD HH:mm:ss；CURRENT Tab 恒为 null */
  wardLeftAt: string | null;
  /** 移出方式，取值见 WARD_LEAVE_REASON；CURRENT Tab 恒为 null */
  wardLeaveReason: string | null;
}

// 列表的"服务层返回形状"（items + total）不放这里：与患者域一致，
// 由 `ward.service.ts` 自己定义 `WardListResult`，控制器再用 `page()` 包成信封。
// 前端 `api/ward.ts` 另有一个同名但含 page/pageSize 的类型，两者分属不同层，不要互相导入。

/**
 * 加入虚拟病区结果。
 * `item` 是更新后的患者列表项（`inVirtualWard` 已翻转为 true），
 * 供前端**局部更新该行**而不整表重查（决策 15），与 `PatientAdmitResult.item` 同理。
 */
export interface WardJoinResult {
  patientId: string;
  wardRecordId: string;
  /** YYYY-MM-DD HH:mm:ss */
  joinedAt: string;
  item: PatientListItem;
}

/**
 * 移出虚拟病区结果。
 * 前端据此把该行从「当前」列表移除；若在历史 Tab 点「加入」，则该行从历史列表移除。
 */
export interface WardLeaveResult {
  patientId: string;
  wardRecordId: string;
  /** YYYY-MM-DD HH:mm:ss */
  leftAt: string;
  leaveReason: string;
}

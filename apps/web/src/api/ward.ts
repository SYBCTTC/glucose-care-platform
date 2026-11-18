import type { VirtualWardListItem, WardJoinResult, WardLeaveResult, WardTab } from '@gc/shared';
import { http } from './client';

/**
 * 虚拟病区接口封装。
 *
 * 数据权限沿用患者域（后端按当前用户科室过滤），前端无需传范围参数；
 * 姓名与患者列表同口径，是确定性密文**等值**匹配，不支持模糊。
 * 完整契约见 docs/specs/virtual-ward.md §3。
 */

export interface WardListParams {
  [key: string]: string | number | undefined;
  departmentId?: string;
  doctorId?: string;
  patientNo?: string;
  name?: string;
  bedNo?: string;
  /** 加入时间区间，仅 tab=CURRENT 生效（YYYY-MM-DD HH:mm:ss） */
  joinFrom?: string;
  joinTo?: string;
  /** 移出时间区间，仅 tab=HISTORY 生效 */
  leaveFrom?: string;
  leaveTo?: string;
  page?: number;
  pageSize?: number;
}

/** 分页信封形状；与 shared 里服务层的同名类型分属不同层，不要互相导入 */
export interface WardListResult {
  items: VirtualWardListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 当前 / 历史虚拟病区列表。
 * tab 决定主条件与日期区间：CURRENT 看在区行、按加入时间筛；HISTORY 看已移出行、按移出时间筛。
 * 跨 Tab 多传的日期字段由后端忽略。
 */
export function fetchWardPatients(tab: WardTab, params: WardListParams): Promise<WardListResult> {
  return http.get<WardListResult>('/ward/patients', { tab, ...params });
}

/**
 * 加入虚拟病区。历史 Tab 的「加入虚拟病区」（= 重新加入）走同一接口，
 * 后端新建一条记录、旧历史行保留。
 * 返回的 `item` 是更新后的患者列表项，供前端局部更新该行而不整表重查。
 * 属写操作，后端记 PATIENT_WARD_JOIN 审计。
 */
export function joinWard(patientId: string): Promise<WardJoinResult> {
  return http.post<WardJoinResult>(`/ward/patients/${patientId}`);
}

/**
 * 移出虚拟病区。后端不校验患者状态（出院患者也应能被移出）。
 * 属写操作，后端记 PATIENT_WARD_REMOVE 审计。
 */
export function leaveWard(patientId: string): Promise<WardLeaveResult> {
  return http.delete<WardLeaveResult>(`/ward/patients/${patientId}`);
}

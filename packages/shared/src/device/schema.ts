import { z } from 'zod';

/**
 * 血糖仪设备契约（前后端共享）。
 * 设备管理员可管理设备，但不具备患者数据权限（见 ROLE_DATA_SCOPE）。
 */

/** 与 Prisma DeviceStatus 保持一致 */
export const DEVICE_STATUS = {
  IDLE: 'IDLE',
  BOUND: 'BOUND',
  OFFLINE: 'OFFLINE',
  DISABLED: 'DISABLED',
} as const;
export type DeviceStatus = (typeof DEVICE_STATUS)[keyof typeof DEVICE_STATUS];

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  IDLE: '未绑定',
  BOUND: '使用中',
  OFFLINE: '离线',
  DISABLED: '已停用',
};

export const createDeviceSchema = z.object({
  sn: z.string().trim().min(1, '请输入设备序列号').max(64),
  model: z.string().trim().min(1, '请输入设备型号').max(64),
  manufacturer: z.string().trim().max(64).optional(),
  firmwareVersion: z.string().trim().max(32).optional(),
  departmentId: z.string().uuid().optional(),
  purchasedAt: z.coerce.date().optional(),
  warrantyUntil: z.coerce.date().optional(),
  remark: z.string().trim().max(255).optional(),
});
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;

export const updateDeviceSchema = createDeviceSchema
  .partial()
  .extend({ id: z.string().uuid('设备 ID 不合法') });
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export const deviceQuerySchema = z.object({
  keyword: z.string().trim().max(64).optional(),
  status: z.nativeEnum(DEVICE_STATUS).optional(),
  departmentId: z.string().uuid().optional(),
  /** 仅看超过 N 小时未上报的设备 */
  offlineHours: z.coerce.number().int().min(1).max(720).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type DeviceQuery = z.infer<typeof deviceQuerySchema>;

/** 绑定：一台设备同时只能绑定一个有效患者 */
export const bindDeviceSchema = z.object({
  deviceId: z.string().uuid('设备 ID 不合法'),
  patientId: z.string().uuid('患者 ID 不合法'),
});
export type BindDeviceInput = z.infer<typeof bindDeviceSchema>;

export const unbindDeviceSchema = bindDeviceSchema;
export type UnbindDeviceInput = z.infer<typeof unbindDeviceSchema>;

/** 设备校准记录：校准属于设备台账，需留痕 */
export const calibrateDeviceSchema = z.object({
  deviceId: z.string().uuid('设备 ID 不合法'),
  calibratedAt: z.coerce.date().default(() => new Date()),
  remark: z.string().trim().max(255).optional(),
});
export type CalibrateDeviceInput = z.infer<typeof calibrateDeviceSchema>;

export const deviceIdSchema = z.object({
  id: z.string().uuid('设备 ID 不合法'),
});

export interface DeviceListItem {
  id: string;
  sn: string;
  model: string;
  manufacturer: string | null;
  firmwareVersion: string | null;
  status: DeviceStatus;
  enabled: boolean;
  lastReportAt: string | null;
  calibratedAt: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** 当前绑定的患者（脱敏），未绑定为 null */
  boundPatient: { id: string; nameMasked: string; bedNo: string | null } | null;
}
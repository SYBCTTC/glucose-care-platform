import type { DictItemOption, DictType } from '@gc/shared';
import { http } from './client';

/** 科室下拉项 */
export interface DepartmentOption {
  id: string;
  name: string;
  code: string;
}

/** 人员下拉项（操作人/责任医生） */
export interface StaffOption {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  roleCodes: string[];
}

/** 设备下拉项 */
export interface DeviceOption {
  id: string;
  sn: string;
  model: string;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
}

/** 公共数据接口：登录后一次性拉取，存入 useCommonDataStore，后续不再请求 */
export function fetchDepartments(): Promise<DepartmentOption[]> {
  return http.get<DepartmentOption[]>('/departments');
}

export function fetchStaff(): Promise<StaffOption[]> {
  return http.get<StaffOption[]>('/staff');
}

export function fetchDevices(): Promise<DeviceOption[]> {
  return http.get<DeviceOption[]>('/devices');
}

/** 动态字典项（公共数据，如血糖监测结果 DY-RESULT） */
export function fetchDictItems(dictType: DictType): Promise<DictItemOption[]> {
  return http.get<DictItemOption[]>(`/dicts/${dictType}`);
}

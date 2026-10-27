import { create } from 'zustand';
import { DICT_TYPE } from '@gc/shared';
import type { DictItemOption, DictType } from '@gc/shared';
import { fetchDepartments, fetchDevices, fetchDictItems, fetchStaff } from '@/api/common-data';
import type { DepartmentOption, DeviceOption, StaffOption } from '@/api/common-data';

interface CommonDataState {
  departments: DepartmentOption[];
  staff: StaffOption[];
  devices: DeviceOption[];
  /** 动态字典（按 dictType 分组），登录后一次性加载 */
  dicts: Partial<Record<DictType, DictItemOption[]>>;
  /** 是否已成功加载（用于幂等） */
  loaded: boolean;
  /** 是否正在加载（并发调用只发一次请求） */
  loading: boolean;
  /** 登录后调用一次；已加载或加载中直接返回 */
  load: () => Promise<void>;
  /** 登出时清空，避免切换账号看到上一账号数据 */
  reset: () => void;
  /** 按角色码筛选人员（如 NURSE / NURSE_HEAD / DOCTOR） */
  staffByRole: (roleCode: string) => StaffOption[];
  /** 按 id 取人员姓名 */
  getStaffName: (id: string) => string;
  /** 取某类字典项；未加载或类型未下发时返回空数组，调用方不用判空 */
  dictItems: (dictType: DictType) => DictItemOption[];
}

function emptyData() {
  return {
    departments: [] as DepartmentOption[],
    staff: [] as StaffOption[],
    devices: [] as DeviceOption[],
    dicts: {} as Partial<Record<DictType, DictItemOption[]>>,
  };
}

export const useCommonDataStore = create<CommonDataState>((set, get) => ({
  ...emptyData(),
  loaded: false,
  loading: false,

  load: async () => {
    const { loaded, loading } = get();
    if (loaded || loading) {
      return;
    }
    set({ loading: true });
    try {
      const [departments, staff, devices, glucoseResults] = await Promise.all([
        fetchDepartments(),
        fetchStaff(),
        fetchDevices(),
        fetchDictItems(DICT_TYPE.GLUCOSE_RESULT),
      ]);
      set({
        departments,
        staff,
        devices,
        dicts: { [DICT_TYPE.GLUCOSE_RESULT]: glucoseResults },
        loaded: true,
      });
    } finally {
      // 失败时不置 loaded，下次调用可重试
      set({ loading: false });
    }
  },

  reset: () => set({ ...emptyData(), loaded: false, loading: false }),

  staffByRole: (roleCode) => get().staff.filter((item) => item.roleCodes.includes(roleCode)),

  getStaffName: (id) => get().staff.find((item) => item.id === id)?.name ?? id,

  dictItems: (dictType) => get().dicts[dictType] ?? [],
}));

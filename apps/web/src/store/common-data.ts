import { create } from 'zustand';
import { fetchDepartments, fetchDevices, fetchStaff } from '@/api/common-data';
import type { DepartmentOption, DeviceOption, StaffOption } from '@/api/common-data';

interface CommonDataState {
  departments: DepartmentOption[];
  staff: StaffOption[];
  devices: DeviceOption[];
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
}

function emptyData() {
  return {
    departments: [] as DepartmentOption[],
    staff: [] as StaffOption[],
    devices: [] as DeviceOption[],
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
      const [departments, staff, devices] = await Promise.all([
        fetchDepartments(),
        fetchStaff(),
        fetchDevices(),
      ]);
      set({ departments, staff, devices, loaded: true });
    } finally {
      // 失败时不置 loaded，下次调用可重试
      set({ loading: false });
    }
  },

  reset: () => set({ ...emptyData(), loaded: false, loading: false }),

  staffByRole: (roleCode) => get().staff.filter((item) => item.roleCodes.includes(roleCode)),

  getStaffName: (id) => get().staff.find((item) => item.id === id)?.name ?? id,
}));

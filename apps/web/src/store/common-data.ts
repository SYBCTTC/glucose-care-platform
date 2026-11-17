import { create } from 'zustand';
import { DICT_TYPE } from '@gc/shared';
import type { DictItemOption, DictType, TimeSlotOption } from '@gc/shared';
import {
  fetchDepartments,
  fetchDevices,
  fetchDictItems,
  fetchStaff,
  fetchTimeSlots,
} from '@/api/common-data';
import type { DepartmentOption, DeviceOption, StaffOption } from '@/api/common-data';

interface CommonDataState {
  departments: DepartmentOption[];
  staff: StaffOption[];
  devices: DeviceOption[];
  /** 动态字典（按 dictType 分组），登录后一次性加载 */
  dicts: Partial<Record<DictType, DictItemOption[]>>;
  /** 时段（DY-TIMESLOT）：含停用项，下拉只用 enabled，历史血糖靠它回显名称 */
  timeSlots: TimeSlotOption[];
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
  /** 按 code 取时段名；库里查不到时返回 code 本身（不用静态清单掩盖数据缺失） */
  getTimeSlotName: (code: string) => string;
}

function emptyData() {
  return {
    departments: [] as DepartmentOption[],
    staff: [] as StaffOption[],
    devices: [] as DeviceOption[],
    dicts: {} as Partial<Record<DictType, DictItemOption[]>>,
    timeSlots: [] as TimeSlotOption[],
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
      const [departments, staff, devices, glucoseResults, timeSlots] = await Promise.all([
        fetchDepartments(),
        fetchStaff(),
        fetchDevices(),
        fetchDictItems(DICT_TYPE.GLUCOSE_RESULT),
        // 时段单独容错：接口异常时置空，避免连累科室/人员/设备全部拿不到。
        // 不再回退静态清单——那会让库里已停用/已改名的时段在前端看起来仍可选，提交后才被服务端拒。
        // 置空后录入弹窗的时段下拉为空并给出提示，是可见的降级，好过静默用错数据。
        fetchTimeSlots().catch((error: unknown) => {
          console.warn('[common-data] 时段加载失败，时段下拉将不可用', error);
          return [] as TimeSlotOption[];
        }),
      ]);
      set({
        departments,
        staff,
        devices,
        dicts: { [DICT_TYPE.GLUCOSE_RESULT]: glucoseResults },
        timeSlots,
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

  // GET /time-slots 会一并下发停用项，历史记录的 code 正常都能取到名称；
  // 真取不到说明库数据有问题，展示裸 code 比用静态名称掩盖更容易被发现。
  getTimeSlotName: (code) => get().timeSlots.find((slot) => slot.code === code)?.name ?? code,
}));

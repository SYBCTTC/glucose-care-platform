import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { DATE_TIME_FORMAT, ROLE_CODE } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

const ALL = 'ALL';
const DEFAULT_THRESHOLD = 3;

export type VirtualWardTab = 'CURRENT' | 'HISTORY';

export const VIRTUAL_WARD_TABS: Array<{ key: VirtualWardTab; label: string }> = [
  { key: 'CURRENT', label: '当前虚拟病区' },
  { key: 'HISTORY', label: '历史虚拟病区' },
];

export interface VirtualWardFilters {
  departmentId: string;
  doctorId: string;
  patientNo: string;
  name: string;
  bedNo: string;
  /** 当前虚拟病区：加入日期区间 */
  joinRange: [Dayjs, Dayjs] | null;
  /** 历史虚拟病区：移出日期区间 */
  leaveRange: [Dayjs, Dayjs] | null;
}

interface VirtualWardListParams {
  departmentId?: string;
  doctorId?: string;
  patientNo?: string;
  name?: string;
  bedNo?: string;
  joinFrom?: string;
  joinTo?: string;
  leaveFrom?: string;
  leaveTo?: string;
  page: number;
  pageSize: number;
}

export interface VirtualWardListResult {
  total: number;
}

function createEmptyFilters(): VirtualWardFilters {
  return {
    departmentId: ALL,
    doctorId: ALL,
    patientNo: '',
    name: '',
    bedNo: '',
    joinRange: null,
    leaveRange: null,
  };
}

function defaultOption<T extends { id: string }>(options: T[]): string {
  if (options.length === 0 || options.length > DEFAULT_THRESHOLD) {
    return ALL;
  }
  return options[0]?.id ?? ALL;
}

function filterDoctors(doctors: StaffOption[], departmentId: string): StaffOption[] {
  return departmentId === ALL
    ? doctors
    : doctors.filter((doctor) => doctor.departmentId === departmentId);
}

/** 参数构建保留给后续接口接入；日期统一 YYYY-MM-DD HH:mm:ss */
function buildParams(filters: VirtualWardFilters, tab: VirtualWardTab): VirtualWardListParams {
  const params: VirtualWardListParams = {
    departmentId: filters.departmentId === ALL ? undefined : filters.departmentId,
    doctorId: filters.doctorId === ALL ? undefined : filters.doctorId,
    patientNo: filters.patientNo.trim() || undefined,
    name: filters.name.trim() || undefined,
    bedNo: filters.bedNo.trim() || undefined,
    page: 1,
    pageSize: 20,
  };
  if (tab === 'CURRENT') {
    params.joinFrom = filters.joinRange?.[0].startOf('day').format(DATE_TIME_FORMAT);
    params.joinTo = filters.joinRange?.[1].endOf('day').format(DATE_TIME_FORMAT);
  } else {
    params.leaveFrom = filters.leaveRange?.[0].startOf('day').format(DATE_TIME_FORMAT);
    params.leaveTo = filters.leaveRange?.[1].endOf('day').format(DATE_TIME_FORMAT);
  }
  return params;
}

export function useVirtualWardQuery() {
  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);
  const commonLoaded = useCommonDataStore((state) => state.loaded);

  const [tab, setTab] = useState<VirtualWardTab>('CURRENT');
  const [filters, setFilters] = useState<VirtualWardFilters>(createEmptyFilters);
  const initializedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VirtualWardListResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const departmentOptions = useMemo<DepartmentOption[]>(() => {
    if (!profile) {
      return [];
    }
    if (profile.dataScope === 'ALL') {
      return departments;
    }
    if (profile.dataScope === 'NONE') {
      return [];
    }
    return departments.filter((item) => item.id === profile.departmentId);
  }, [departments, profile]);

  const allDoctors = useMemo(
    () => staff.filter((item) => item.roleCodes.includes(ROLE_CODE.DOCTOR)),
    [staff],
  );

  const doctorOptions = useMemo(
    () => filterDoctors(allDoctors, filters.departmentId),
    [allDoctors, filters.departmentId],
  );

  const runQuery = useCallback(async (nextFilters: VirtualWardFilters, nextTab: VirtualWardTab) => {
    setLoading(true);
    setError(null);
    try {
      // TODO: 后续接入虚拟病区列表接口，提交 buildParams(nextFilters, nextTab)
      void buildParams(nextFilters, nextTab);
      setResult({ total: 0 });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 公共数据就绪后计算默认科室/医生，并自动查询一次。
   * 与患者管理一致，用 ref 同步守卫，避免 StrictMode 下重复执行。
   */
  useEffect(() => {
    if (initializedRef.current || !profile || !commonLoaded) {
      return;
    }
    initializedRef.current = true;
    const departmentId = defaultOption(departmentOptions);
    const next: VirtualWardFilters = {
      ...createEmptyFilters(),
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    };
    setFilters(next);
    void runQuery(next, tab);
  }, [profile, commonLoaded, departmentOptions, allDoctors, runQuery, tab]);

  const changeTab = (nextTab: VirtualWardTab) => {
    const next: VirtualWardFilters = {
      ...filters,
      joinRange: null,
      leaveRange: null,
    };
    setTab(nextTab);
    setFilters(next);
    void runQuery(next, nextTab);
  };

  const setDepartment = (departmentId: string) => {
    setFilters((prev) => ({
      ...prev,
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    }));
  };

  const setDoctor = (doctorId: string) => {
    setFilters((prev) => ({ ...prev, doctorId }));
  };

  const patch = (partial: Partial<VirtualWardFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const search = () => {
    void runQuery(filters, tab);
  };

  const reset = () => {
    const departmentId = defaultOption(departmentOptions);
    const next: VirtualWardFilters = {
      ...createEmptyFilters(),
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    };
    setFilters(next);
    void runQuery(next, tab);
  };

  return {
    tab,
    changeTab,
    filters,
    departmentOptions,
    doctorOptions,
    setDepartment,
    setDoctor,
    patch,
    search,
    reset,
    loading,
    result,
    error,
  };
}

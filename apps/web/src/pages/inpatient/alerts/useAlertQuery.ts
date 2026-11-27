import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { ROLE_CODE } from '@gc/shared';
import type { AlertAdmissionStatus, GlucoseAlertListResponse } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import { fetchGlucoseAlerts, type GlucoseAlertListParams } from '@/api/alert';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import { resolveAlertTimeRange, type TimePreset } from './alert-time';
import type { AlertTab } from './alert-stats';

/** "所有"占位值：查询时不向后端传对应字段（同 usePatientQuery 约定） */
const ALL = 'ALL';
/** 下拉数量阈值：≤3 默认第一个，>3 默认"所有"（同 usePatientQuery 约定） */
const DEFAULT_THRESHOLD = 3;
/** 列表默认每页条数（规格 §6：分页 20 条/页） */
const DEFAULT_PAGE_SIZE = 20;

/**
 * 预警管理页查询状态（P4-7，规格 §4/§6）。
 * 交互骨架复用患者管理（裁定 R2-Q2）：
 * - 点「查询」才发请求；「重置」回默认（住院状态=住院、时间=本月、其余清空）；
 * - 切 Tab **保留筛选条件**并自动重新查询（页码归 1）；
 * - 科室/医生默认值走「≤3 选第一个、>3 选所有」约定，医生随科室联动。
 * 与患者管理的差异：无卡片模式、无返回快照（本页无详情跳转）。
 */
export interface AlertFilters {
  /** ALL = 所有科室（占位值，不送后端） */
  departmentId: string;
  /** ALL = 所有医生（占位值，不送后端） */
  doctorId: string;
  patientNo: string;
  /** 姓名：密文精确匹配（同患者管理，placeholder 已注明） */
  name: string;
  bedNo: string;
  /** 默认住院（需求默认态） */
  admissionStatus: AlertAdmissionStatus;
  /** 默认本月 */
  timePreset: TimePreset;
  /** timePreset='custom' 时才有值 */
  customRange: [Dayjs, Dayjs] | null;
  /** 大于/小于（InputNumber 值，null = 未填；宽松校验见裁定 R2-Q4） */
  valueGt: number | null;
  valueLt: number | null;
}

function createEmptyFilters(): AlertFilters {
  return {
    departmentId: ALL,
    doctorId: ALL,
    patientNo: '',
    name: '',
    bedNo: '',
    admissionStatus: 'inpatient',
    timePreset: 'thisMonth',
    customRange: null,
    valueGt: null,
    valueLt: null,
  };
}

/** ≤3 选第一个，>3 选"所有"；空列表退化为"所有"（同 usePatientQuery） */
function defaultOption<T extends { id: string }>(options: T[]): string {
  if (options.length === 0 || options.length > DEFAULT_THRESHOLD) {
    return ALL;
  }
  return options[0]?.id ?? ALL;
}

/** 医生联动：选"所有科室"时返回全部医生（同 usePatientQuery） */
function filterDoctors(doctors: StaffOption[], departmentId: string): StaffOption[] {
  return departmentId === ALL
    ? doctors
    : doctors.filter((doctor) => doctor.departmentId === departmentId);
}

export function useAlertQuery() {
  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);
  const commonLoaded = useCommonDataStore((state) => state.loaded);

  const [tab, setTab] = useState<AlertTab>('all');
  const [filters, setFilters] = useState<AlertFilters>(createEmptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GlucoseAlertListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  /** 科室下拉：按数据范围收敛，避免选到无权查看的科室（同 usePatientQuery） */
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

  /** 医生下拉：公共数据中仅取医生角色，再按选中科室联动（同 usePatientQuery） */
  const allDoctors = useMemo(
    () => staff.filter((item) => item.roleCodes.includes(ROLE_CODE.DOCTOR)),
    [staff],
  );

  const doctorOptions = useMemo(
    () => filterDoctors(allDoctors, filters.departmentId),
    [allDoctors, filters.departmentId],
  );

  const runQuery = useCallback(
    async (
      nextFilters: AlertFilters,
      nextTab: AlertTab,
      nextPage: number,
      nextPageSize: number,
    ) => {
      setLoading(true);
      setError(null);
      const range = resolveAlertTimeRange(nextFilters.timePreset, nextFilters.customRange);
      const params: GlucoseAlertListParams = {
        type: nextTab === 'all' ? undefined : nextTab,
        departmentId: nextFilters.departmentId === ALL ? undefined : nextFilters.departmentId,
        doctorId: nextFilters.doctorId === ALL ? undefined : nextFilters.doctorId,
        patientNo: nextFilters.patientNo.trim() || undefined,
        name: nextFilters.name.trim() || undefined,
        bedNo: nextFilters.bedNo.trim() || undefined,
        admissionStatus: nextFilters.admissionStatus,
        startTime: range.startTime,
        endTime: range.endTime,
        valueGt: nextFilters.valueGt ?? undefined,
        valueLt: nextFilters.valueLt ?? undefined,
        page: nextPage,
        pageSize: nextPageSize,
      };
      try {
        setResult(await fetchGlucoseAlerts(params));
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : '查询失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /**
   * 公共数据就绪后计算默认科室/医生并自动查询一次（默认 住院＋本月＋所有预警）。
   * 守卫用 ref 而非 state：StrictMode 重复执行 effect 时 state 更新尚未提交，
   * 第二次 effect 仍会读到旧值导致双查；ref 同步生效（同 usePatientQuery）。
   */
  useEffect(() => {
    if (initializedRef.current || !profile || !commonLoaded) {
      return;
    }
    initializedRef.current = true;
    const departmentId = defaultOption(departmentOptions);
    const initial: AlertFilters = {
      ...createEmptyFilters(),
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    };
    setFilters(initial);
    void runQuery(initial, 'all', 1, DEFAULT_PAGE_SIZE);
  }, [profile, commonLoaded, departmentOptions, allDoctors, runQuery]);

  /** 切 Tab：保留筛选条件并自动重查，页码归 1（裁定 R2-Q2） */
  const changeTab = (nextTab: AlertTab) => {
    setTab(nextTab);
    setPage(1);
    if (initializedRef.current) {
      void runQuery(filters, nextTab, 1, pageSize);
    }
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

  const patch = (partial: Partial<AlertFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const search = () => {
    setPage(1);
    if (initializedRef.current) {
      void runQuery(filters, tab, 1, pageSize);
    }
  };

  /** 重置回默认：住院状态=住院、时间=本月、其余清空（裁定 R2-Q2）；保留当前 Tab */
  const reset = () => {
    const departmentId = defaultOption(departmentOptions);
    const next: AlertFilters = {
      ...createEmptyFilters(),
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    };
    setFilters(next);
    setPage(1);
    if (initializedRef.current) {
      void runQuery(next, tab, 1, pageSize);
    }
  };

  const changePage = (nextPage: number, nextPageSize: number) => {
    setPage(nextPage);
    setPageSize(nextPageSize);
    if (initializedRef.current) {
      void runQuery(filters, tab, nextPage, nextPageSize);
    }
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
    page,
    pageSize,
    changePage,
    loading,
    result,
    error,
  };
}

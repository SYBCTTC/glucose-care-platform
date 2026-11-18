import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { DATE_TIME_FORMAT, PATIENT_STATUS, ROLE_CODE } from '@gc/shared';
import type { PatientListItem, PatientStatus } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import { fetchPatients, type PatientListParams, type PatientListResult } from '@/api/patient';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import {
  asInt,
  asOneOf,
  asString,
  deserializeRange,
  readListSnapshot,
  serializeRange,
  writeListSnapshot,
} from '../list-nav-state';

/** "所有"占位值：查询时不向后端传对应字段 */
const ALL = 'ALL';
/** 下拉数量阈值：≤3 默认第一个，>3 默认"所有" */
const DEFAULT_THRESHOLD = 3;
/** 列表默认每页条数 */
const DEFAULT_PAGE_SIZE = 20;
/** 卡片滚动加载每批条数 */
const CARD_PAGE_SIZE = 20;

export type PatientViewMode = 'CARD' | 'LIST';

export interface PatientFilters {
  departmentId: string;
  doctorId: string;
  patientNo: string;
  name: string;
  bedNo: string;
  admissionRange: [Dayjs, Dayjs] | null;
  dischargeRange: [Dayjs, Dayjs] | null;
}

function createEmptyFilters(): PatientFilters {
  return {
    departmentId: ALL,
    doctorId: ALL,
    patientNo: '',
    name: '',
    bedNo: '',
    admissionRange: null,
    dischargeRange: null,
  };
}

/** ≤3 选第一个，>3 选"所有"；空列表退化为"所有" */
function defaultOption<T extends { id: string }>(options: T[]): string {
  if (options.length === 0 || options.length > DEFAULT_THRESHOLD) {
    return ALL;
  }
  return options[0]?.id ?? ALL;
}

/** 医生联动：选"所有科室"时返回全部医生 */
function filterDoctors(doctors: StaffOption[], departmentId: string): StaffOption[] {
  return departmentId === ALL
    ? doctors
    : doctors.filter((doctor) => doctor.departmentId === departmentId);
}

function buildParams(filters: PatientFilters, page: number, pageSize: number): PatientListParams {
  return {
    departmentId: filters.departmentId === ALL ? undefined : filters.departmentId,
    doctorId: filters.doctorId === ALL ? undefined : filters.doctorId,
    patientNo: filters.patientNo.trim() || undefined,
    name: filters.name.trim() || undefined,
    bedNo: filters.bedNo.trim() || undefined,
    admissionFrom: filters.admissionRange?.[0].startOf('day').format(DATE_TIME_FORMAT),
    admissionTo: filters.admissionRange?.[1].endOf('day').format(DATE_TIME_FORMAT),
    dischargeFrom: filters.dischargeRange?.[0].startOf('day').format(DATE_TIME_FORMAT),
    dischargeTo: filters.dischargeRange?.[1].endOf('day').format(DATE_TIME_FORMAT),
    page,
    pageSize,
  };
}

/** C1 方式B：可持久化到 history.state 的查询状态快照（Dayjs 区间已序列化为 ISO 字符串） */
interface PatientQuerySnapshot {
  status: PatientStatus;
  viewMode: PatientViewMode;
  filters: PatientFilters;
  page: number;
  pageSize: number;
}

const STATUS_OPTIONS = [PATIENT_STATUS.INPATIENT, PATIENT_STATUS.DISCHARGED] as const;
const VIEW_MODE_OPTIONS: PatientViewMode[] = ['CARD', 'LIST'];

/** 当前查询状态 → 可结构化克隆的快照 payload */
function toSnapshot(state: PatientQuerySnapshot): Record<string, unknown> {
  return {
    status: state.status,
    viewMode: state.viewMode,
    filters: {
      departmentId: state.filters.departmentId,
      doctorId: state.filters.doctorId,
      patientNo: state.filters.patientNo,
      name: state.filters.name,
      bedNo: state.filters.bedNo,
      admissionRange: serializeRange(state.filters.admissionRange),
      dischargeRange: serializeRange(state.filters.dischargeRange),
    },
    page: state.page,
    pageSize: state.pageSize,
  };
}

/** history.state 快照 → 查询状态；损坏/缺失返回 null（回退默认）。科室/医生有效性由调用方在选项就绪后校验 */
function parseSnapshot(raw: unknown): PatientQuerySnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const rawFilters =
    obj.filters && typeof obj.filters === 'object' ? (obj.filters as Record<string, unknown>) : {};
  return {
    status: asOneOf(obj.status, STATUS_OPTIONS, PATIENT_STATUS.INPATIENT),
    viewMode: asOneOf(obj.viewMode, VIEW_MODE_OPTIONS, 'CARD'),
    filters: {
      departmentId: asString(rawFilters.departmentId, ALL),
      doctorId: asString(rawFilters.doctorId, ALL),
      patientNo: asString(rawFilters.patientNo),
      name: asString(rawFilters.name),
      bedNo: asString(rawFilters.bedNo),
      admissionRange: deserializeRange(rawFilters.admissionRange),
      dischargeRange: deserializeRange(rawFilters.dischargeRange),
    },
    page: asInt(obj.page, 1),
    pageSize: asInt(obj.pageSize, DEFAULT_PAGE_SIZE),
  };
}

/** 选项有效性：'ALL' 恒有效，否则须仍在当前可见选项内（数据范围可能已变） */
function isValidOption(value: string, options: Array<{ id: string }>): boolean {
  return value === ALL || options.some((option) => option.id === value);
}

/**
 * 患者管理页顶部筛选状态。
 * - 科室/医生选项按当前用户数据范围过滤（ALL→全院，DEPARTMENT/SELF→本科室，NONE→空）
 * - 默认值在公共数据加载完成后计算一次；重置时按同一规则恢复并自动查询
 */
export function usePatientQuery(initialStatus: PatientStatus, enabled = true) {
  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);
  const commonLoaded = useCommonDataStore((state) => state.loaded);

  // C1 方式B：挂载时读一次历史快照（从详情页 navigate(-1) 返回时携带）；惰性初始化只跑一次
  const [restored] = useState<PatientQuerySnapshot | null>(() =>
    parseSnapshot(readListSnapshot('patients')),
  );

  const [status, setStatus] = useState<PatientStatus>(restored?.status ?? initialStatus);
  const [viewMode, setViewMode] = useState<PatientViewMode>(restored?.viewMode ?? 'CARD');
  const [filters, setFilters] = useState<PatientFilters>(restored?.filters ?? createEmptyFilters);
  const initializedRef = useRef(false);
  const [page, setPage] = useState(restored?.page ?? 1);
  const [pageSize, setPageSize] = useState(restored?.pageSize ?? DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PatientListResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cardItems, setCardItems] = useState<PatientListItem[]>([]);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardHasMore, setCardHasMore] = useState(true);
  const [cardError, setCardError] = useState<string | null>(null);
  const cardPageRef = useRef(0);
  const cardLoadingRef = useRef(false);
  const cardHasMoreRef = useRef(true);
  const cardRequestIdRef = useRef(0);

  /** 科室下拉：按数据范围收敛，避免选到无权查看的科室 */
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

  /** 医生下拉：公共数据中仅取医生角色，再按选中科室联动 */
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
      nextFilters: PatientFilters,
      nextStatus: PatientStatus,
      nextPage: number,
      nextPageSize: number,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPatients(
          nextStatus,
          buildParams(nextFilters, nextPage, nextPageSize),
        );
        setResult(data);
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : '查询失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearCardState = useCallback(() => {
    cardRequestIdRef.current += 1;
    cardPageRef.current = 0;
    cardHasMoreRef.current = true;
    cardLoadingRef.current = false;
    setCardItems([]);
    setCardLoading(false);
    setCardHasMore(true);
    setCardError(null);
  }, []);

  /** 卡片模式：reset=true 从第一页重查，false 追加下一页 */
  const runCardQuery = useCallback(
    async (nextFilters: PatientFilters, nextStatus: PatientStatus, reset: boolean) => {
      if (reset) {
        clearCardState();
      } else if (!initializedRef.current || cardLoadingRef.current || !cardHasMoreRef.current) {
        // 初始化前一律不发请求：默认筛选还在等公共数据，此时 filters 仍是"全部"，
        // 而首屏卡片哨兵就在视口内，会先发一次无筛选的请求，初始化后再发一次 → 重复请求。
        return;
      }

      const requestId = cardRequestIdRef.current;
      const nextPage = cardPageRef.current + 1;
      cardLoadingRef.current = true;
      setCardLoading(true);
      setCardError(null);

      try {
        const data = await fetchPatients(
          nextStatus,
          buildParams(nextFilters, nextPage, CARD_PAGE_SIZE),
        );
        if (requestId !== cardRequestIdRef.current) {
          return;
        }
        setCardItems((prev) => {
          const base = reset ? [] : prev;
          const ids = new Set(base.map((item) => item.id));
          return [...base, ...data.items.filter((item) => !ids.has(item.id))];
        });
        cardPageRef.current = nextPage;
        const hasMore = nextPage * CARD_PAGE_SIZE < data.total;
        cardHasMoreRef.current = hasMore;
        setCardHasMore(hasMore);
      } catch (err) {
        if (requestId !== cardRequestIdRef.current) {
          return;
        }
        cardHasMoreRef.current = false;
        setCardHasMore(false);
        setCardError(err instanceof Error ? err.message : '查询失败');
      } finally {
        if (requestId === cardRequestIdRef.current) {
          cardLoadingRef.current = false;
          setCardLoading(false);
        }
      }
    },
    [clearCardState],
  );

  /**
   * 公共数据就绪后计算默认科室/医生，并自动查询一次。
   * 守卫用 ref 而非 state：StrictMode 会重复执行 effect，state 更新尚未提交时
   * 第二次 effect 仍会读到旧值，导致初始化查询发两次；ref 是同步生效的。
   */
  useEffect(() => {
    if (!enabled) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current || !profile || !commonLoaded) {
      return;
    }
    initializedRef.current = true;

    let next: PatientFilters;
    let nextPage: number;
    let nextPageSize: number;
    if (restored) {
      // 还原路径：校验快照里的科室/医生是否仍在可见选项内（数据范围可能已变），失效则回退默认；
      // 其余筛选/视图/页码沿用快照。卡片模式仍从第 1 页重载（滚动位置不还原，决策 C1）。
      const departmentId = isValidOption(restored.filters.departmentId, departmentOptions)
        ? restored.filters.departmentId
        : defaultOption(departmentOptions);
      const doctors = filterDoctors(allDoctors, departmentId);
      const doctorId = isValidOption(restored.filters.doctorId, doctors)
        ? restored.filters.doctorId
        : defaultOption(doctors);
      next = { ...restored.filters, departmentId, doctorId };
      nextPage = restored.page;
      nextPageSize = restored.pageSize;
    } else {
      // 首次进入：按数据范围计算默认科室/医生
      const departmentId = defaultOption(departmentOptions);
      next = {
        ...createEmptyFilters(),
        departmentId,
        doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
      };
      nextPage = 1;
      nextPageSize = DEFAULT_PAGE_SIZE;
    }
    setFilters(next);
    if (status === PATIENT_STATUS.INPATIENT && viewMode === 'CARD') {
      void runCardQuery(next, status, true);
    } else {
      void runQuery(next, status, nextPage, nextPageSize);
    }
  }, [
    enabled,
    profile,
    commonLoaded,
    departmentOptions,
    allDoctors,
    runQuery,
    runCardQuery,
    status,
    viewMode,
    restored,
  ]);

  // C1 方式B：已提交状态变化时写入当前历史条目，供从详情页返回时还原。
  // 初始化前不写（避免覆盖刚读到的快照）；卡片滚动加载只改 cardItems，不在依赖内，不会触发写入。
  useEffect(() => {
    if (!initializedRef.current) {
      return;
    }
    writeListSnapshot('patients', toSnapshot({ status, viewMode, filters, page, pageSize }));
  }, [status, viewMode, filters, page, pageSize]);

  const changeStatus = (nextStatus: PatientStatus) => {
    setStatus(nextStatus);
    setPage(1);
    setResult(null);
    clearCardState();
    if (!enabled) {
      return;
    }
    if (nextStatus === PATIENT_STATUS.INPATIENT && viewMode === 'CARD') {
      void runCardQuery(filters, nextStatus, true);
    } else {
      void runQuery(filters, nextStatus, 1, pageSize);
    }
  };

  const changeViewMode = (nextMode: PatientViewMode) => {
    setViewMode(nextMode);
    setPage(1);
    if (nextMode === 'LIST') {
      setResult(null);
    }
    if (!enabled || status !== PATIENT_STATUS.INPATIENT) {
      return;
    }
    clearCardState();
    if (nextMode === 'CARD') {
      void runCardQuery(filters, status, true);
    } else {
      void runQuery(filters, status, 1, pageSize);
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

  const patch = (partial: Partial<PatientFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const search = () => {
    setPage(1);
    if (!enabled) {
      return;
    }
    if (status === PATIENT_STATUS.INPATIENT && viewMode === 'CARD') {
      void runCardQuery(filters, status, true);
    } else {
      void runQuery(filters, status, 1, pageSize);
    }
  };

  const reset = () => {
    const departmentId = defaultOption(departmentOptions);
    const next: PatientFilters = {
      ...createEmptyFilters(),
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    };
    setFilters(next);
    setPage(1);
    if (!enabled) {
      return;
    }
    if (status === PATIENT_STATUS.INPATIENT && viewMode === 'CARD') {
      void runCardQuery(next, status, true);
    } else {
      void runQuery(next, status, 1, pageSize);
    }
  };

  /** 按当前筛选与视图重查一次（新增/编辑后刷新列表用） */
  const refresh = () => {
    if (!enabled) {
      return;
    }
    if (status === PATIENT_STATUS.INPATIENT && viewMode === 'CARD') {
      void runCardQuery(filters, status, true);
    } else {
      void runQuery(filters, status, page, pageSize);
    }
  };

  /**
   * 局部替换单条患者（编辑成功后用）。
   * 不走 refresh 是因为卡片模式的 refresh 会清空列表并从第 1 页重查，
   * 编辑一个靠后的患者会让滚动位置跳回顶部。
   */
  const patchItem = useCallback((item: PatientListItem) => {
    setCardItems((prev) => prev.map((current) => (current.id === item.id ? item : current)));
    setResult((prev) =>
      prev
        ? { ...prev, items: prev.items.map((current) => (current.id === item.id ? item : current)) }
        : prev,
    );
  }, []);

  const changePage = (nextPage: number, nextPageSize: number) => {
    setPage(nextPage);
    setPageSize(nextPageSize);
    if (enabled) {
      void runQuery(filters, status, nextPage, nextPageSize);
    }
  };

  const loadMore = () => {
    if (!enabled || status !== PATIENT_STATUS.INPATIENT || viewMode !== 'CARD') {
      return;
    }
    void runCardQuery(filters, status, false);
  };

  const retryCards = () => {
    if (!enabled || status !== PATIENT_STATUS.INPATIENT || viewMode !== 'CARD') {
      return;
    }
    const reset = cardPageRef.current === 0;
    cardHasMoreRef.current = true;
    setCardHasMore(true);
    setCardError(null);
    void runCardQuery(filters, status, reset);
  };

  const isCardMode = status === PATIENT_STATUS.INPATIENT && viewMode === 'CARD';

  return {
    status,
    changeStatus,
    viewMode,
    changeViewMode,
    isCardMode,
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
    refresh,
    patchItem,
    loading,
    result,
    error,
    cardItems,
    cardLoading,
    cardHasMore,
    cardError,
    loadMore,
    retryCards,
    filterLoading: isCardMode ? cardLoading && cardItems.length === 0 : loading,
    activeError: isCardMode ? cardError : error,
  };
}

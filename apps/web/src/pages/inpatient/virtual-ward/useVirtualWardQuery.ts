import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dayjs } from 'dayjs';
import { DATE_TIME_FORMAT, PERMISSION, ROLE_CODE, WARD_TAB, WARD_TAB_LABELS } from '@gc/shared';
import type { VirtualWardListItem, WardTab } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import { fetchWardPatients, type WardListParams, type WardListResult } from '@/api/ward';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

/**
 * 虚拟病区页的查询状态。
 *
 * 与患者管理页同构（决策 4：展示一致），因此沿用 `usePatientQuery` 的**命令式双路径**：
 * 查询只在 `search()` / `reset()` / `changeTab()` / `changeViewMode()` / `changePage()`
 * 与初始化 effect 里显式触发，输入框打字（`patch`）只改本地 state、**不发请求**，
 * 避免每敲一个字就查一次库。
 *  - 当前 Tab + 卡片模式 → 滚动加载，本地 state 累积 cardItems
 *  - 其余（当前 Tab 列表模式、历史 Tab）→ 标准分页
 * 历史 Tab **没有卡片模式**（决策 4），切过去时强制按列表渲染。
 *
 * 加入/移出成功后调 `removeItem` 做**局部更新**（决策 15），不整表重查：
 * 当前 Tab 移除 → 该行消失；历史 Tab 加入 → 该行也消失（患者已回到当前 Tab）。
 */

/** "所有"占位值：查询时不向后端传对应字段 */
const ALL = 'ALL';
/** 下拉数量阈值：≤3 默认第一个，>3 默认"所有" */
const DEFAULT_THRESHOLD = 3;
/** 列表默认每页条数 */
const DEFAULT_PAGE_SIZE = 20;
/** 卡片滚动加载每批条数 */
const CARD_PAGE_SIZE = 20;

export type WardViewMode = 'CARD' | 'LIST';

/** 对外暴露的 Tab 类型即共享契约的 `WardTab`，避免两套字面量漂移 */
export type VirtualWardTab = WardTab;

export const VIRTUAL_WARD_TABS: Array<{ key: VirtualWardTab; label: string }> = [
  { key: WARD_TAB.CURRENT, label: WARD_TAB_LABELS.CURRENT },
  { key: WARD_TAB.HISTORY, label: WARD_TAB_LABELS.HISTORY },
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

/**
 * 组装查询参数。加入时间区间只对当前 Tab 有意义，移出时间区间只对历史 Tab 有意义；
 * 跨 Tab 的字段不发送（后端也会忽略）。日期统一 YYYY-MM-DD HH:mm:ss。
 */
function buildParams(
  filters: VirtualWardFilters,
  tab: WardTab,
  page: number,
  pageSize: number,
): WardListParams {
  const params: WardListParams = {
    departmentId: filters.departmentId === ALL ? undefined : filters.departmentId,
    doctorId: filters.doctorId === ALL ? undefined : filters.doctorId,
    patientNo: filters.patientNo.trim() || undefined,
    name: filters.name.trim() || undefined,
    bedNo: filters.bedNo.trim() || undefined,
    page,
    pageSize,
  };
  if (tab === WARD_TAB.CURRENT) {
    params.joinFrom = filters.joinRange?.[0].startOf('day').format(DATE_TIME_FORMAT);
    params.joinTo = filters.joinRange?.[1].endOf('day').format(DATE_TIME_FORMAT);
  } else {
    params.leaveFrom = filters.leaveRange?.[0].startOf('day').format(DATE_TIME_FORMAT);
    params.leaveTo = filters.leaveRange?.[1].endOf('day').format(DATE_TIME_FORMAT);
  }
  return params;
}

export function useVirtualWardQuery(enabled = true) {
  const profile = useAuthStore((state) => state.profile);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);
  const commonLoaded = useCommonDataStore((state) => state.loaded);

  /** 是否有虚拟病区查看权限：无权限时页面直接渲染 403，不发请求 */
  const canView = hasPermission(PERMISSION.WARD_VIEW);
  /** 是否有虚拟病区操作权限：无权限时不渲染「更多操作」菜单 */
  const canManage = hasPermission(PERMISSION.WARD_MANAGE);
  const queryEnabled = enabled && canView;

  const [tab, setTab] = useState<WardTab>(WARD_TAB.CURRENT);
  const [viewMode, setViewMode] = useState<WardViewMode>('CARD');
  const [filters, setFilters] = useState<VirtualWardFilters>(createEmptyFilters);
  const initializedRef = useRef(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WardListResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cardItems, setCardItems] = useState<VirtualWardListItem[]>([]);
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
    async (nextFilters: VirtualWardFilters, nextTab: WardTab, nextPage: number, nextPageSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchWardPatients(
          nextTab,
          buildParams(nextFilters, nextTab, nextPage, nextPageSize),
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
    async (nextFilters: VirtualWardFilters, nextTab: WardTab, reset: boolean) => {
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
        const data = await fetchWardPatients(
          nextTab,
          buildParams(nextFilters, nextTab, nextPage, CARD_PAGE_SIZE),
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
    if (!queryEnabled) {
      initializedRef.current = false;
      return;
    }
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
    if (tab === WARD_TAB.CURRENT && viewMode === 'CARD') {
      void runCardQuery(next, tab, true);
    } else {
      void runQuery(next, tab, 1, DEFAULT_PAGE_SIZE);
    }
  }, [
    queryEnabled,
    profile,
    commonLoaded,
    departmentOptions,
    allDoctors,
    runQuery,
    runCardQuery,
    tab,
    viewMode,
  ]);

  const changeTab = (nextTab: WardTab) => {
    // 切 Tab 清掉日期区间：joinRange 只对 CURRENT 有意义、leaveRange 只对 HISTORY 有意义，
    // 带着上一个 Tab 的区间过去会造成"筛了个看不见的条件"的困惑。
    const next: VirtualWardFilters = { ...filters, joinRange: null, leaveRange: null };
    setTab(nextTab);
    setFilters(next);
    setPage(1);
    setResult(null);
    clearCardState();
    if (!queryEnabled) {
      return;
    }
    if (nextTab === WARD_TAB.CURRENT && viewMode === 'CARD') {
      void runCardQuery(next, nextTab, true);
    } else {
      void runQuery(next, nextTab, 1, pageSize);
    }
  };

  const changeViewMode = (nextMode: WardViewMode) => {
    setViewMode(nextMode);
    setPage(1);
    if (nextMode === 'LIST') {
      setResult(null);
    }
    if (!queryEnabled) {
      return;
    }
    clearCardState();
    if (tab === WARD_TAB.CURRENT && nextMode === 'CARD') {
      void runCardQuery(filters, tab, true);
    } else {
      void runQuery(filters, tab, 1, pageSize);
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

  const patch = (partial: Partial<VirtualWardFilters>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const search = () => {
    setPage(1);
    if (!queryEnabled) {
      return;
    }
    if (tab === WARD_TAB.CURRENT && viewMode === 'CARD') {
      void runCardQuery(filters, tab, true);
    } else {
      void runQuery(filters, tab, 1, pageSize);
    }
  };

  const reset = () => {
    const departmentId = defaultOption(departmentOptions);
    const next: VirtualWardFilters = {
      ...createEmptyFilters(),
      departmentId,
      doctorId: defaultOption(filterDoctors(allDoctors, departmentId)),
    };
    setFilters(next);
    setPage(1);
    if (!queryEnabled) {
      return;
    }
    if (tab === WARD_TAB.CURRENT && viewMode === 'CARD') {
      void runCardQuery(next, tab, true);
    } else {
      void runQuery(next, tab, 1, pageSize);
    }
  };

  /** 按当前筛选与视图重查一次（预留：加入/移出后若需整表刷新可用） */
  const refresh = () => {
    if (!queryEnabled) {
      return;
    }
    if (tab === WARD_TAB.CURRENT && viewMode === 'CARD') {
      void runCardQuery(filters, tab, true);
    } else {
      void runQuery(filters, tab, page, pageSize);
    }
  };

  const changePage = (nextPage: number, nextPageSize: number) => {
    setPage(nextPage);
    setPageSize(nextPageSize);
    if (queryEnabled) {
      void runQuery(filters, tab, nextPage, nextPageSize);
    }
  };

  const loadMore = () => {
    if (!queryEnabled || tab !== WARD_TAB.CURRENT || viewMode !== 'CARD') {
      return;
    }
    void runCardQuery(filters, tab, false);
  };

  const retryCards = () => {
    if (!queryEnabled || tab !== WARD_TAB.CURRENT || viewMode !== 'CARD') {
      return;
    }
    const reset = cardPageRef.current === 0;
    cardHasMoreRef.current = true;
    setCardHasMore(true);
    setCardError(null);
    void runCardQuery(filters, tab, reset);
  };

  /**
   * 加入/移出成功后把该行从当前视图移除（决策 15：局部更新，不整表重查）。
   * 两种模式都要处理：卡片模式是本地 cardItems，列表模式是本地 result。
   */
  const removeItem = useCallback((patientId: string) => {
    setCardItems((prev) => prev.filter((item) => item.id !== patientId));
    setResult((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((item) => item.id !== patientId),
            total: Math.max(0, prev.total - 1),
          }
        : prev,
    );
  }, []);

  const isCurrent = tab === WARD_TAB.CURRENT;
  /** 卡片模式只在当前 Tab 出现；历史 Tab 只有列表 */
  const isCardMode = isCurrent && viewMode === 'CARD';

  return {
    tab,
    isCurrent,
    canView,
    canManage,
    viewMode,
    isCardMode,
    filters,
    departmentOptions,
    doctorOptions,
    setDepartment,
    setDoctor,
    patch,
    search,
    reset,
    refresh,
    page,
    pageSize,
    changePage,
    result,
    loading,
    activeError: isCardMode ? cardError : error,
    cardItems,
    cardLoading,
    cardHasMore,
    cardError,
    loadMore,
    retryCards,
    removeItem,
    changeTab,
    changeViewMode,
    filterLoading: isCardMode ? cardLoading && cardItems.length === 0 : loading,
  };
}

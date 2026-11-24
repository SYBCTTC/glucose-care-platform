import { useCallback, useEffect, useState } from 'react';
import type { GlucoseTrendResponse } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchGlucoseTrend } from '@/api/glucose';

export interface GlucoseTrendState {
  data: GlucoseTrendResponse | null;
  loading: boolean;
  /** 错误文案；null 表示无错误 */
  error: string | null;
  /** 是否越权（HTTP 403，跨科室数据范围拦截） */
  forbidden: boolean;
  /** 手动重取（错误后重试按钮用） */
  reload: () => void;
}

const IDLE: Omit<GlucoseTrendState, 'reload'> = {
  data: null,
  loading: false,
  error: null,
  forbidden: false,
};

/**
 * 趋势查询范围（P3-7）：与报表/记录 `Range` 同口径——
 * 秒粒度本地时间字符串（YYYY-MM-DD HH:mm:ss），字段缺省 = 该侧不限。
 * 独立类型不 import 报表/记录的：三页的「已应用范围」演进可能分叉，
 * 共享类型会让任一页的改动波及另一页（同 useGlucoseRecords 的理由）。
 */
export interface GlucoseTrendRange {
  startTime?: string;
  endTime?: string;
}

/**
 * 拉取血糖趋势（GET /patients/:id/glucose/trend，P3-7）。
 *
 * 与 `useGlucoseReport` / `useGlucoseRecords` 同风格同语义（手写 useState/useEffect +
 * `cancelled` 标志丢弃过期响应，全仓零 TanStack Query）。**不分页**：趋势图一次取范围内全部数值点。
 * 触发重取的因素：
 *  - `patientId`：换患者；
 *  - `version`：壳层「添加血糖」/ 本页复核弹窗编辑、作废成功后自增，趋势立刻反映变化；
 *  - `range`：已应用的秒粒度查询范围（点「查询」/初始默认态/重置才更新，改表单不触发请求）；
 *  - `mealContexts`：时段过滤（逗号分隔码，2026-11-24 增补）；`undefined` = 不过滤（「全部」）。
 *    勾选/取消时段即变 → 立即重查（裁定：与报表/记录「改筛选即查」一致）；
 *  - `ready`：住院记录树未就绪时**不发请求**且 loading 恒真——初始加载必须按默认条件
 *    查询（R24 裁定 Q15 口径），不能先拉一次全量再拉一次默认范围。
 */
export function useGlucoseTrend(
  patientId: string | undefined,
  version: number,
  range: GlucoseTrendRange,
  mealContexts: string | undefined,
  ready: boolean,
): GlucoseTrendState {
  const [state, setState] = useState({ ...IDLE, loading: Boolean(patientId) });
  const [nonce, setNonce] = useState(0);
  // 解构成原始值进依赖：range 是调用方持有的对象，整对象进依赖会因引用变化多拉一次
  const { startTime, endTime } = range;

  useEffect(() => {
    if (!patientId) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    if (!ready) {
      setState((prev) => ({ ...prev, loading: true }));
      return;
    }
    let cancelled = false;
    // 重取时保留旧 data、只置 loading：图表显示 loading 而不是闪成空白
    setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));

    const load = async (): Promise<void> => {
      try {
        const data = await fetchGlucoseTrend(patientId, { startTime, endTime, mealContexts });
        if (!cancelled) {
          setState({ data, loading: false, error: null, forbidden: false });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const forbidden = error instanceof ApiError && error.status === 403;
        const message =
          error instanceof Error && error.message ? error.message : '加载血糖趋势失败';
        setState({ data: null, loading: false, error: message, forbidden });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [patientId, version, nonce, startTime, endTime, mealContexts, ready]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}

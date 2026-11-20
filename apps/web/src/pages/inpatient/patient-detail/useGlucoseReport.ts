import { useCallback, useEffect, useState } from 'react';
import { GLUCOSE_REPORT_PAGE_SIZE } from '@gc/shared';
import type { GlucoseReportResponse } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchGlucoseReport } from '@/api/glucose';

export interface GlucoseReportState {
  data: GlucoseReportResponse | null;
  loading: boolean;
  /** 错误文案；null 表示无错误 */
  error: string | null;
  /** 是否越权（HTTP 403，跨科室数据范围拦截） */
  forbidden: boolean;
  /** 手动重取（错误后重试按钮用） */
  reload: () => void;
}

const IDLE: Omit<GlucoseReportState, 'reload'> = {
  data: null,
  loading: false,
  error: null,
  forbidden: false,
};

/** 报表查询范围（R24）：秒粒度本地时间字符串（YYYY-MM-DD HH:mm:ss），缺省 = 该侧不限 */
export interface GlucoseReportRange {
  startTime?: string;
  endTime?: string;
}

/**
 * 拉取血糖报告（GET /patients/:id/glucose/report）。
 *
 * 与 `usePatientDetail` 同风格：手写 useState/useEffect + `cancelled` 标志丢弃过期响应，
 * **不引入 TanStack Query**（全仓零 `useQuery` 使用，保持一致）。
 *
 * 触发重取的因素：
 *  - `patientId`：换患者；
 *  - `page`：翻页（服务端分页，`pageSize` 固定 15 个**日期**）；
 *  - `version`：外部信号。详情页壳里的「添加血糖」成功后自增，让报表立刻反映新记录——
 *    录入弹窗挂在壳上、报表数据在子路由里，两者不同层，靠 `<Outlet context>` 打通；
 *  - `range`（R24）：已应用的秒粒度查询范围。只有点「查询」/初始默认态/重置才更新，
 *    改表单本身不触发请求；
 *  - `ready`（R24）：住院记录树未就绪时**不发请求**且 loading 恒真——初始加载必须
 *    按默认条件查询（裁定 Q15），不能先拉一次全量再拉一次默认范围。
 */
export function useGlucoseReport(
  patientId: string | undefined,
  page: number,
  version: number,
  range: GlucoseReportRange,
  ready: boolean,
): GlucoseReportState {
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
    // 翻页时保留旧 data、只置 loading：表格显示 loading 遮罩而不是闪成空白
    setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));

    const load = async (): Promise<void> => {
      try {
        const data = await fetchGlucoseReport(patientId, {
          page,
          pageSize: GLUCOSE_REPORT_PAGE_SIZE,
          startTime,
          endTime,
        });
        if (!cancelled) {
          setState({ data, loading: false, error: null, forbidden: false });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const forbidden = error instanceof ApiError && error.status === 403;
        const message =
          error instanceof Error && error.message ? error.message : '加载血糖报告失败';
        setState({ data: null, loading: false, error: message, forbidden });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [patientId, page, version, nonce, startTime, endTime, ready]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}

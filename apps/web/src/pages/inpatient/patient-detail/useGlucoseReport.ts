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

/**
 * 拉取血糖报告（GET /patients/:id/glucose/report）。
 *
 * 与 `usePatientDetail` 同风格：手写 useState/useEffect + `cancelled` 标志丢弃过期响应，
 * **不引入 TanStack Query**（全仓零 `useQuery` 使用，保持一致）。
 *
 * 三个触发重取的因素：
 *  - `patientId`：换患者；
 *  - `page`：翻页（服务端分页，`pageSize` 固定 15 个**日期**）；
 *  - `version`：外部信号。详情页壳里的「添加血糖」成功后自增，让报表立刻反映新记录——
 *    录入弹窗挂在壳上、报表数据在子路由里，两者不同层，靠 `<Outlet context>` 打通。
 *
 * 日期范围（`startDate`/`endDate`）本轮不传：日期选择器涉及出入院业务，单开任务（R6）。
 */
export function useGlucoseReport(
  patientId: string | undefined,
  page: number,
  version: number,
): GlucoseReportState {
  const [state, setState] = useState({ ...IDLE, loading: Boolean(patientId) });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!patientId) {
      setState({ ...IDLE, error: '缺少患者 ID' });
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
  }, [patientId, page, version, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}

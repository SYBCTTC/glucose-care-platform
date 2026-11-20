import { useEffect, useState } from 'react';
import type { AdmissionsResponse } from '@gc/shared';
import { fetchAdmissions } from '@/api/patient';

export interface AdmissionsState {
  data: AdmissionsResponse | null;
  loading: boolean;
  /** 错误文案；null 表示无错误。失败时表单退化为「全部 + 无限制」可用态（规格 §6） */
  error: string | null;
}

const IDLE: AdmissionsState = { data: null, loading: false, error: null };

/**
 * 住院记录树（R24，GET /patients/:id/admissions）。
 *
 * 与 `useGlucoseReport` 同风格：手写 useState/useEffect + `cancelled` 标志丢弃过期响应。
 * 一次性树形下发（裁定 Q4），报表查询表单的住院/科室联动全部基于这份数据纯本地推导。
 *
 * 失败不阻塞报表本体：调用方在 error 时按「全部 + 无限制」默认态放行报表请求。
 */
export function useAdmissions(patientId: string | undefined): AdmissionsState {
  const [state, setState] = useState<AdmissionsState>({ ...IDLE, loading: Boolean(patientId) });

  useEffect(() => {
    if (!patientId) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    let cancelled = false;
    // 换患者时**清空旧数据**（不能只置 loading）：否则报表表单会拿上一个患者的
    // 住院记录初始化默认态（竞态）
    setState({ ...IDLE, loading: true });

    const load = async (): Promise<void> => {
      try {
        const data = await fetchAdmissions(patientId);
        if (!cancelled) {
          setState({ data, loading: false, error: null });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error && error.message ? error.message : '加载住院记录失败';
        setState({ data: null, loading: false, error: message });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return state;
}

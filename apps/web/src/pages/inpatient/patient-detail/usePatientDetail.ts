import { useEffect, useState } from 'react';
import type { PatientDetail } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchPatientDetail } from '@/api/patient';

export interface PatientDetailState {
  data: PatientDetail | null;
  loading: boolean;
  /** 错误文案；null 表示无错误 */
  error: string | null;
  /** 是否越权（HTTP 403，跨科室数据范围拦截），用于错误页区分文案 */
  forbidden: boolean;
}

const IDLE: PatientDetailState = { data: null, loading: false, error: null, forbidden: false };

/**
 * 拉取患者详情（GET /patients/:id）。
 * 后端每次访问都会写一条 PATIENT_VIEW 审计（"访问即留痕"，决策 A3）。
 * 与列表页 hook 同风格（手动 useState/useEffect，非 TanStack Query）；id 变化时重查，
 * 卸载/切 id 时用 cancelled 标志丢弃过期响应，避免竞态与卸载后 setState。
 */
export function usePatientDetail(id: string | undefined): PatientDetailState {
  const [state, setState] = useState<PatientDetailState>({ ...IDLE, loading: Boolean(id) });

  useEffect(() => {
    if (!id) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));

    const load = async (): Promise<void> => {
      try {
        const data = await fetchPatientDetail(id);
        if (!cancelled) {
          setState({ data, loading: false, error: null, forbidden: false });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const forbidden = error instanceof ApiError && error.status === 403;
        const message =
          error instanceof Error && error.message ? error.message : '加载患者详情失败';
        setState({ data: null, loading: false, error: message, forbidden });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}

import { useEffect, useRef, useState } from 'react';
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
 * 与列表页 hook 同风格（手动 useState/useEffect，非 TanStack Query）；id 变化时重查。
 *
 * **StrictMode 守卫**（2026-11-20）：React 18 开发模式下 StrictMode 会 mount → cleanup →
 * remount 使 effect 跑两次，两次请求都真的发出、服务端各写一条 PATIENT_VIEW，审计表因此
 * 出现成对重复行（生产构建不双调用，不受影响）。用 `requestedIdRef` 记录已为哪个 id 发过
 * 请求、第二次执行直接跳过——同 `usePatientQuery.ts` 的 `initializedRef` 口径。
 *
 * ⚠️ 竞态/卸载保护随之从闭包 `cancelled` 改为 `activeIdRef` 比对，且**必须在判守卫之前复位**：
 * cleanup 会把 `activeIdRef` 置 null，remount 时若不复位，在飞请求返回时会被当成过期响应丢弃，
 * 而守卫又拦掉了重发 → 页面恒 loading（本改动最容易踩的坑）。
 * 换患者（id 变）与刷新页面（组件重建、两个 ref 归零）仍正常请求，重试路径与改动前一致。
 *
 * **version 信号**（P2-6 落地原注释预留方案）：「同 id 强制重取」通过递增 version 触发
 * （办理出院/住院成功后详情页停留原地刷新状态）。守卫与竞态比对都改用 `id#version`
 * 组合键，StrictMode 双执行守卫语义不变。
 */
export function usePatientDetail(id: string | undefined, version = 0): PatientDetailState {
  const [state, setState] = useState<PatientDetailState>({ ...IDLE, loading: Boolean(id) });
  /** 已为哪个请求键（id#version）发过请求：StrictMode 第二次执行据此跳过，避免重复请求与重复审计 */
  const requestedIdRef = useRef<string | null>(null);
  /** 当前应采纳响应的请求键：cleanup 置 null（卸载即失效），换键时被新值覆盖（丢弃过期响应） */
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    const requestKey = `${id}#${version}`;
    // 先复位再判守卫：StrictMode 的 cleanup 刚把它置 null，此处必须恢复，
    // 否则第一次请求的响应会被当成过期数据丢弃
    activeIdRef.current = requestKey;
    if (requestedIdRef.current === requestKey) {
      return;
    }
    requestedIdRef.current = requestKey;
    setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));

    const load = async (): Promise<void> => {
      try {
        const data = await fetchPatientDetail(id);
        if (activeIdRef.current === requestKey) {
          setState({ data, loading: false, error: null, forbidden: false });
        }
      } catch (error) {
        if (activeIdRef.current !== requestKey) {
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
      activeIdRef.current = null;
    };
  }, [id, version]);

  return state;
}

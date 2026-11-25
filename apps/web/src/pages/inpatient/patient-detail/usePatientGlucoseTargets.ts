import { useCallback, useEffect, useRef, useState } from 'react';
import type { PatientGlucoseTargetsResponse } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchPatientGlucoseTargets } from '@/api/patient';

export interface PatientGlucoseTargetsState {
  data: PatientGlucoseTargetsResponse | null;
  loading: boolean;
  /** 错误文案；null 表示无错误 */
  error: string | null;
  /** 是否越权（HTTP 403，跨科室数据范围拦截），用于错误页区分文案 */
  forbidden: boolean;
  /** 手动重取：编辑成功后刷新展示区、以及错误后的重试按钮 */
  reload: () => void;
}

const IDLE: Omit<PatientGlucoseTargetsState, 'reload'> = {
  data: null,
  loading: false,
  error: null,
  forbidden: false,
};

/**
 * 拉取患者控糖目标（GET /patients/:id/glucose-targets），规格 §3.1。
 *
 * 与 `usePatientDetail` / `useGlucoseReport` 同风格：手写 useState/useEffect，
 * **不引入 TanStack Query**（全仓零 `useQuery` 使用，保持一致）。
 *
 * **StrictMode 守卫（本 hook 的关键约束）**：后端每次 GET 都写一条 `PATIENT_TARGET_VIEW`
 * 审计行（2026-11-25 裁定）。React 18 开发模式下 StrictMode 会 mount → cleanup → remount
 * 使 effect 跑两次，两次请求都真的发出、审计表因此出现成对重复行（同 `usePatientDetail`
 * 踩过的 `PATIENT_VIEW` 重复问题）。用 `requestedKeyRef` 记录已为哪个 key 发过请求，
 * 第二次执行直接跳过。
 *
 * ⚠️ 守卫的 key 是 `${patientId}#${nonce}` 而**不是** `patientId`：`usePatientDetail` 只按 id
 * 守卫，代价是「同 id 无法强制重取」（其注释已标明该限制）。本 hook 必须在编辑成功后重取
 * （否则展示区停在旧值），故把 `reload()` 自增的 nonce 一并编进 key —— nonce 变化即视为
 * 一次新的合法请求，守卫放行；StrictMode 的重复执行因 nonce 未变仍被拦住。
 *
 * ⚠️ 竞态/卸载保护用 `activeKeyRef` 比对，且**必须在判守卫之前复位**：cleanup 会把它置 null，
 * remount 时若不复位，在飞请求返回时会被当成过期响应丢弃，而守卫又拦掉了重发 → 页面恒 loading。
 */
export function usePatientGlucoseTargets(
  patientId: string | undefined,
): PatientGlucoseTargetsState {
  const [state, setState] = useState({ ...IDLE, loading: Boolean(patientId) });
  const [nonce, setNonce] = useState(0);
  /** 已为哪个 key 发过请求：StrictMode 第二次执行据此跳过，避免重复请求与重复审计 */
  const requestedKeyRef = useRef<string | null>(null);
  /** 当前应采纳响应的 key：cleanup 置 null（卸载即失效），换 key 时被新值覆盖（丢弃过期响应） */
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    const key = `${patientId}#${nonce}`;
    // 先复位再判守卫（见上方 JSDoc 的第二个 ⚠️）
    activeKeyRef.current = key;
    if (requestedKeyRef.current === key) {
      return;
    }
    requestedKeyRef.current = key;
    // 重取时保留旧 data、只置 loading：展示区显示 loading 而不是闪成空白
    setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));

    const load = async (): Promise<void> => {
      try {
        const data = await fetchPatientGlucoseTargets(patientId);
        if (activeKeyRef.current === key) {
          setState({ data, loading: false, error: null, forbidden: false });
        }
      } catch (error) {
        if (activeKeyRef.current !== key) {
          return;
        }
        const forbidden = error instanceof ApiError && error.status === 403;
        const message =
          error instanceof Error && error.message ? error.message : '加载控糖目标失败';
        setState({ data: null, loading: false, error: message, forbidden });
      }
    };
    void load();

    return () => {
      activeKeyRef.current = null;
    };
  }, [patientId, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}

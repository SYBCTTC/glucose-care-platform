import { useEffect, useRef, useState } from 'react';
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
 * 与 `useGlucoseReport` 同风格：手写 useState/useEffect。
 * 一次性树形下发（裁定 Q4），报表查询表单的住院/科室联动全部基于这份数据纯本地推导。
 *
 * 失败不阻塞报表本体：调用方在 error 时按「全部 + 无限制」默认态放行报表请求。
 *
 * **StrictMode 守卫**（2026-11-20）：React 18 开发模式下 StrictMode 会 mount → cleanup →
 * remount 使 effect 跑两次，两次请求都真的发出、服务端各写一条 ADMISSION_QUERY 审计
 * （生产构建不双调用，不受影响）。用 `requestedIdRef` 让第二次执行直接跳过，
 * 同 `usePatientDetail` 与 `usePatientQuery.ts` 的 `initializedRef` 口径。
 *
 * ⚠️ 竞态/卸载保护随之从闭包 `cancelled` 改为 `activeIdRef` 比对，且**必须在判守卫之前复位**：
 * cleanup 会把 `activeIdRef` 置 null，remount 时若不复位，在飞请求返回时会被当成过期响应丢弃，
 * 而守卫又拦掉了重发 → 表单恒 loading、报表因 `ready` 永不为真而发不出请求。
 *
 * `version`（2026-11-26 出入院记录 Tab 增补，可选、默认 0）：同患者下的**重拉信号**——
 * 详情页办理出院/住院成功后自增，本 Tab 记录随之刷新（规格 §4）。守卫键升级为
 * `患者#version` 组合（同 usePatientDetail 口径）；version 变化**不清空旧数据**
 * （同一患者，表格闪空无意义），换患者仍清空（防跨患者竞态）。血糖三个子 Tab 不传，行为不变。
 */
export function useAdmissions(patientId: string | undefined, version = 0): AdmissionsState {
  const [state, setState] = useState<AdmissionsState>({ ...IDLE, loading: Boolean(patientId) });
  /** 已为哪个「患者#version」发过请求：StrictMode 第二次执行据此跳过，避免重复请求与重复审计 */
  const requestedIdRef = useRef<string | null>(null);
  /** 当前应采纳响应的请求键：cleanup 置 null（卸载即失效），重拉时被新值覆盖（丢弃过期响应） */
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    const requestKey = `${patientId}#${version}`;
    // 先复位再判守卫：StrictMode 的 cleanup 刚把它置 null，此处必须恢复，
    // 否则第一次请求的响应会被当成过期数据丢弃
    activeIdRef.current = requestKey;
    if (requestedIdRef.current === requestKey) {
      return;
    }
    // 换患者（守卫键的患者段不同）才清空旧数据：否则报表表单会拿上一个患者的
    // 住院记录初始化默认态（竞态）；同患者 version 重拉保留旧表格，只置 loading
    const patientChanged =
      requestedIdRef.current === null || !requestedIdRef.current.startsWith(`${patientId}#`);
    requestedIdRef.current = requestKey;
    if (patientChanged) {
      setState({ ...IDLE, loading: true });
    } else {
      setState((previous) => ({ ...previous, loading: true }));
    }

    const load = async (): Promise<void> => {
      try {
        const data = await fetchAdmissions(patientId);
        if (activeIdRef.current === requestKey) {
          setState({ data, loading: false, error: null });
        }
      } catch (error) {
        if (activeIdRef.current !== requestKey) {
          return;
        }
        const message =
          error instanceof Error && error.message ? error.message : '加载住院记录失败';
        setState({ data: null, loading: false, error: message });
      }
    };
    void load();

    return () => {
      activeIdRef.current = null;
    };
  }, [patientId, version]);

  return state;
}

import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { buildDetailTabNavigation } from './detail-tabs';

/**
 * 详情页内 Tab 跳转的**唯一出口**。详情页里不应再出现第二处 `navigate` 调用。
 *
 * `replace: true` 与 `state` 透传这两个约束固化在 `buildDetailTabNavigation` 里
 * （纯函数，单测见 `detail-tabs.spec.ts`），本 hook 只负责接上 Router 的三个上下文值。
 * 这样约束不会因为"某处又直接调了一次 navigate"而被绕过。
 */
export function useDetailTabNavigate() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { id } = useParams<{ id: string }>();

  return useCallback(
    (subPath: string): void => {
      const { to, options } = buildDetailTabNavigation(id, subPath, state);
      navigate(to, options);
    },
    [navigate, state, id],
  );
}

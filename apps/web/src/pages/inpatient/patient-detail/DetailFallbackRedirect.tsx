import { Navigate, useLocation, useParams } from 'react-router-dom';
import { DETAIL_DEFAULT_TAB, DETAIL_PATH_PREFIX } from './detail-tabs';

/**
 * index 路由与 `*` 兜底路由**共用**的重定向组件，目标都是「血糖数据 → 血糖报告」。
 *
 * 两条路由各自的职责：
 *  - `index`：裸详情 URL（书签、手输、旧链接）落到默认页，满足需求 1；
 *  - `*`：未知子路径（如 `/inpatient/patients/<id>/xxx`）也落到默认页。
 *    没有它，未匹配的 URL 会让 `<Outlet/>` 渲染 null——Tab 栏还在、内容区一片空白、
 *    且没有任何 Tab 高亮，看起来像页面坏了。
 *
 * 正常入口（列表页点患者姓名）**不经过这里**：两处 `goDetail` 直接跳 `.../glucose/report`，
 * 从而完全避开 `replace` 覆盖 history 条目的风险。本组件只服务直接访问 URL 的场景。
 *
 * ⚠️ `state` 必须透传：`replace` 会用新条目覆盖当前条目，不带上 state 就等于清空
 * `location.state.from`，`index.tsx` 的 `handleBack` 会退化成兜底跳患者管理。
 */
export default function DetailFallbackRedirect() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();

  return (
    <Navigate to={`${DETAIL_PATH_PREFIX}${id}/${DETAIL_DEFAULT_TAB}`} replace state={state} />
  );
}

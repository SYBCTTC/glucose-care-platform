import { Empty } from 'antd';
import { layoutSize } from '@/styles/tokens';

/**
 * 详情页尚未实现的内容页占位。
 *
 * 现仅「出入院记录」一条子路由在用：血糖记录（R27）与趋势图（P3-7）已替换为正式页面，
 * 原「基本信息」已于 2026-11-25 改为「控糖目标」正式页面（裁定 M，
 * `docs/specs/patient-glucose-target.md` §6.1）。保留本组件供剩余占位与将来新 Tab 复用。
 *
 * 与 `@/pages/Placeholder`（整页占位，用于菜单里尚未立项的功能）不同：
 * 本组件渲染在详情页 Tabs 区内部，只占内容区，Tab 栏与患者摘要仍然可见。
 * **不发任何请求**——占位页不该产生审计记录。
 */
export default function DetailPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: `${layoutSize.cardPadding * 2}px 0`,
        textAlign: 'center',
      }}
    >
      <Empty description={`${label}（建设中）`} />
    </div>
  );
}

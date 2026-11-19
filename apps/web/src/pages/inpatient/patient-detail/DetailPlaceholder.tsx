import { Empty } from 'antd';
import { layoutSize } from '@/styles/tokens';

/**
 * 详情页尚未实现的内容页占位。
 *
 * 基本信息 / 出入院记录 / 血糖记录 / 趋势图 四条子路由共用，
 * 抽出来是为了避免 4 份相同的 `Empty` + 内联样式（改间距要改 4 处）。
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

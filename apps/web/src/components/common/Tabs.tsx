import { theme } from 'antd';
import { Fragment, type ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  /**
   * underline：文字 + 下划线高亮
   * background：文字 + 背景色高亮
   * 默认下划线，患者管理当前使用该样式。
   */
  variant?: 'underline' | 'background';
}

/** 轻量 Tab：主题色取 antd token，不硬编码颜色 */
export default function Tabs({ items, value, onChange, variant = 'underline' }: TabsProps) {
  const { token } = theme.useToken();

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        width: variant === 'background' ? 'fit-content' : undefined,
        gap: variant === 'background' ? 0 : 4,
        // background 变体边框（含下边框）= 1px solid rgb(205,205,205)，色值走令牌
        border: variant === 'background' ? '1px solid var(--gc-color-tab-border)' : undefined,
        // ⚠️ borderBottom 必须显式赋值、不可为 undefined：React 会把 undefined 写成 ''，
        // CSSOM 随即移除上面 border 简写已设的下边框分量 → background 变体下边框不渲染
        //（历史遗留缺陷，2026-11-23 实机取证定位）
        borderBottom:
          variant === 'background'
            ? '1px solid var(--gc-color-tab-border)'
            : `1px solid ${token.colorBorderSecondary}`,
        // background 变体整体下边距 8px（公共组件，患者管理/虚拟病区视图 Tabs 同样生效）
        marginBottom: variant === 'background' ? 'var(--gc-space-sm)' : undefined,
      }}
    >
      {items.map((item, index) => {
        const active = item.key === value;
        return (
          <Fragment key={item.key}>
            {/* background 变体项间竖线：上下各留 2px，颜色同边框 */}
            {variant === 'background' && index > 0 ? (
              <span
                aria-hidden
                style={{
                  flex: 'none',
                  width: 1,
                  margin: '2px 0',
                  background: 'var(--gc-color-tab-border)',
                }}
              />
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.key)}
              style={{
                border: 'none',
                cursor: 'pointer',
                background: active && variant === 'background' ? token.colorPrimary : 'transparent',
                color: active
                  ? variant === 'background'
                    ? token.colorTextLightSolid
                    : token.colorPrimary
                  : token.colorText,
                fontWeight: active ? 600 : 400,
                padding: '8px 16px',
                borderRadius: 0,
                borderBottom:
                  active && variant === 'underline'
                    ? `2px solid ${token.colorPrimary}`
                    : '2px solid transparent',
                marginBottom: variant === 'underline' ? -1 : 0,
                transition: 'color 0.2s, background 0.2s',
              }}
            >
              {item.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

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

/** 轻量 Tab：主题色取 antd token；边框/项间竖线取设计令牌 --gc-color-tab-border */
export default function Tabs({ items, value, onChange, variant = 'underline' }: TabsProps) {
  const { token } = theme.useToken();
  const isUnderline = variant === 'underline';

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        width: variant === 'background' ? 'fit-content' : undefined,
        gap: variant === 'background' ? 0 : 4,
        border: variant === 'background' ? '1px solid var(--gc-color-tab-border)' : undefined,
        borderBottom: isUnderline ? '1px solid var(--gc-color-tab-border)' : undefined,
        marginBottom: isUnderline ? 'var(--gc-space-sm)' : undefined,
      }}
    >
      {items.map((item, index) => {
        const active = item.key === value;
        return (
          <Fragment key={item.key}>
            {/* underline 变体项间竖线：上下各留 2px，颜色同边框 */}
            {isUnderline && index > 0 ? (
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
                  active && isUnderline
                    ? `2px solid ${token.colorPrimary}`
                    : '2px solid transparent',
                marginBottom: isUnderline ? -1 : 0,
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

import { theme } from 'antd';
import type { ReactNode } from 'react';

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
        border: variant === 'background' ? '1px solid #cdcdcd' : undefined,
        borderBottom:
          variant === 'underline' ? `1px solid ${token.colorBorderSecondary}` : undefined,
      }}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            style={{
              border: 'none',
              cursor: 'pointer',
              background:
                active && variant === 'background' ? token.colorPrimary : 'transparent',
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
        );
      })}
    </div>
  );
}

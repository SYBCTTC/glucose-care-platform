import { Alert, Card, Space } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  note: string;
  /** 操作区，占位阶段用于承接后续动作入口（如按钮） */
  action?: ReactNode;
}

/** 未实现模块的占位页（P4/P5 落地后逐个替换） */
export default function PlaceholderPage({ title, note, action }: Props) {
  return (
    <Card title={title}>
      <Alert
        type="warning"
        showIcon
        message="该模块尚未实现"
        description={`${note}。实现时请遵循 AGENTS.md 与 .codebuddy/rules 下的规范。`}
      />
      {action ? (
        <Space style={{ marginTop: 16 }}>{action}</Space>
      ) : null}
    </Card>
  );
}

import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Space } from 'antd';

interface SearchActionsProps {
  onSearch: () => void;
  onReset: () => void;
  loading?: boolean;
}

/** 查询 / 重置按钮组：重置由调用方负责恢复默认条件并重新查询 */
export default function SearchActions({ onSearch, onReset, loading }: SearchActionsProps) {
  return (
    <Space>
      <Button type="primary" icon={<SearchOutlined />} onClick={onSearch} loading={loading}>
        查询
      </Button>
      <Button icon={<ReloadOutlined />} onClick={onReset} disabled={loading}>
        重置
      </Button>
    </Space>
  );
}

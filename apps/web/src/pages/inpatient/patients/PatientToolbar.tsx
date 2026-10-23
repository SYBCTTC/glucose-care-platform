import { DownOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space, message } from 'antd';
import { PATIENT_STATUS, PATIENT_STATUS_LABELS, PERMISSION } from '@gc/shared';
import type { PatientStatus } from '@gc/shared';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import { useAuthStore } from '@/store/auth';

interface PatientToolbarProps {
  value: PatientStatus;
  onChange: (value: PatientStatus) => void;
}

export default function PatientToolbar({ value, onChange }: PatientToolbarProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission);

  const items: TabItem[] = [];
  if (hasPermission(PERMISSION.PATIENT_INPATIENT_VIEW)) {
    items.push({ key: PATIENT_STATUS.INPATIENT, label: PATIENT_STATUS_LABELS.INPATIENT });
  }
  if (hasPermission(PERMISSION.PATIENT_DISCHARGED_VIEW)) {
    items.push({ key: PATIENT_STATUS.DISCHARGED, label: PATIENT_STATUS_LABELS.DISCHARGED });
  }

  // 添加/批量添加仅住院 Tab 且具备患者管理权限时显示
  const canManage =
    hasPermission(PERMISSION.PATIENT_MANAGE) && value === PATIENT_STATUS.INPATIENT;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}
    >
      <Tabs
        items={items}
        value={value}
        onChange={(key) => onChange(key as PatientStatus)}
        variant="underline"
      />
      {canManage ? (
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => message.info('添加患者功能开发中')}
          >
            添加患者
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'template',
                  icon: <DownloadOutlined />,
                  label: '模板下载',
                  onClick: () => message.info('模板下载功能开发中'),
                },
                {
                  key: 'import',
                  icon: <UploadOutlined />,
                  label: '批量导入',
                  onClick: () => message.info('批量导入功能开发中'),
                },
              ],
            }}
          >
            <Button icon={<PlusOutlined />}>
              批量添加 <DownOutlined />
            </Button>
          </Dropdown>
        </Space>
      ) : null}
    </div>
  );
}

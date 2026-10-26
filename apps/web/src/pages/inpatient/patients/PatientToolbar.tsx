import { DownOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space, message } from 'antd';
import { PATIENT_STATUS, PATIENT_STATUS_LABELS, PERMISSION } from '@gc/shared';
import type { PatientStatus } from '@gc/shared';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import { useAuthStore } from '@/store/auth';

interface PatientToolbarProps {
  value: PatientStatus;
  onChange: (value: PatientStatus) => void;
  /** 打开"添加患者"弹窗 */
  onAddPatient: () => void;
}

export default function PatientToolbar({ value, onChange, onAddPatient }: PatientToolbarProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission);

  const items: TabItem[] = [];
  if (hasPermission(PERMISSION.PATIENT_INPATIENT_VIEW)) {
    items.push({ key: PATIENT_STATUS.INPATIENT, label: PATIENT_STATUS_LABELS.INPATIENT });
  }
  if (hasPermission(PERMISSION.PATIENT_DISCHARGED_VIEW)) {
    items.push({ key: PATIENT_STATUS.DISCHARGED, label: PATIENT_STATUS_LABELS.DISCHARGED });
  }

  // 添加患者：住院 Tab + 建档权限点（patient:create），与编辑等管理动作分离
  const canCreate = hasPermission(PERMISSION.PATIENT_CREATE) && value === PATIENT_STATUS.INPATIENT;
  // 批量添加：走患者管理权限点（本期未实现，仅占位）
  const canBulk = hasPermission(PERMISSION.PATIENT_MANAGE) && value === PATIENT_STATUS.INPATIENT;

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
      {canCreate || canBulk ? (
        <Space>
          {canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddPatient}>
              添加患者
            </Button>
          ) : null}
          {canBulk ? (
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
          ) : null}
        </Space>
      ) : null}
    </div>
  );
}

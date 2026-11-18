import { Button, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { PATIENT_STATUS_LABELS } from '@gc/shared';
import type { PatientDetail } from '@gc/shared';
import { layoutSize } from '@/styles/tokens';
import { formatAge, getGenderLabel } from '../patients/patient-format';

interface PatientBasicInfoProps {
  detail: PatientDetail;
  /** 是否展示"添加血糖"按钮：住院患者 + GLUCOSE_CREATE 权限（决策 D5） */
  canAddGlucose: boolean;
  onAddGlucose: () => void;
}

/**
 * 详情页顶部「患者基本信息区」——始终可见的摘要，区别于主 Tab 里的"基本信息"页（决策 D4）。
 * 横向流动布局（flex-wrap）；字段顺序见决策 D1/D2：姓名/性别/年龄只显示值，其余 label：值。
 * "添加血糖"按钮紧贴右下角（决策 D3）。颜色/字号一律取 antd token，间距取 layoutSize，禁硬编码。
 */
export default function PatientBasicInfo({
  detail,
  canAddGlucose,
  onAddGlucose,
}: PatientBasicInfoProps) {
  const { token } = theme.useToken();

  // 决策 D1 字段顺序：入院时间、手机号、身份证、状态、住院号、科室、责任医生、责任护士
  const fields: Array<{ label: string; value: string; numeric?: boolean }> = [
    { label: '入院时间', value: detail.admissionAt ?? '-', numeric: true },
    { label: '手机号', value: detail.phoneMasked ?? '-' },
    { label: '身份证', value: detail.idCardMasked ?? '-' },
    { label: '状态', value: PATIENT_STATUS_LABELS[detail.status] },
    { label: '住院号', value: detail.patientNo ?? '-' },
    { label: '科室', value: detail.departmentName },
    { label: '责任医生', value: detail.doctorName ?? '-' },
    { label: '责任护士', value: detail.nurseName ?? '-' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: layoutSize.cardGap,
      }}
    >
      {/* 姓名：页面主体标识，加粗放大（决策 D2，只显示值） */}
      <span style={{ fontSize: token.fontSizeLG, fontWeight: 600, color: token.colorText }}>
        {detail.nameMasked}
      </span>
      {/* 性别 / 年龄：只显示值（决策 D1）；年龄是数字，用 gc-num 等宽数字 */}
      <span style={{ color: token.colorText }}>{getGenderLabel(detail.gender)}</span>
      <span className="gc-num" style={{ color: token.colorText }}>
        {formatAge(detail.age)}
      </span>

      {fields.map((field) => (
        <span
          key={field.label}
          style={{ display: 'inline-flex', alignItems: 'baseline', gap: token.marginXXS }}
        >
          <span style={{ color: token.colorTextSecondary }}>{field.label}：</span>
          <span className={field.numeric ? 'gc-num' : undefined} style={{ color: token.colorText }}>
            {field.value}
          </span>
        </span>
      ))}

      {canAddGlucose ? (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onAddGlucose}
          style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}
        >
          添加血糖
        </Button>
      ) : null}
    </div>
  );
}

import { useMemo } from 'react';
import { Button, Dropdown, theme } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { DIABETES_TYPE_LABELS, PATIENT_STATUS_LABELS } from '@gc/shared';
import type { PatientDetail } from '@gc/shared';
import { layoutSize } from '@/styles/tokens';
import { formatAge, getGenderLabel } from '../patients/patient-format';

interface PatientBasicInfoProps {
  detail: PatientDetail;
  /** 是否展示"添加血糖"按钮：住院患者 + GLUCOSE_CREATE 权限（决策 D5） */
  canAddGlucose: boolean;
  onAddGlucose: () => void;
  /** 「更多操作」下拉：住院患者 + patient:update（2026-11-26 需求，裁定 Q3 排首项；出院患者不展示，裁定规则 3） */
  canEdit: boolean;
  onEdit: () => void;
  /** P2-6「更多操作」下拉：住院患者 + patient:discharge（裁定 Q3/6，无权限仅隐藏该项） */
  canDischarge: boolean;
  /** P2-6「更多操作」下拉：出院患者 + patient:admit */
  canAdmit: boolean;
  onDischarge: () => void;
  onAdmit: () => void;
}

/**
 * 详情页顶部「患者基本信息区」——始终可见的摘要，区别于主 Tab 里的"基本信息"页（决策 D4）。
 * 横向流动布局（flex-wrap）；字段顺序见决策 D1/D2：姓名/性别/年龄只显示值，其余 label：值。
 * 2026-11-26 需求：年龄与入院时间之间加「糖尿病类型」，样式同姓名（加粗放大、只显示值）。
 * "添加血糖"按钮紧贴右下角（决策 D3）。颜色/字号一律取 antd token，间距取 layoutSize，禁硬编码。
 */
export default function PatientBasicInfo({
  detail,
  canAddGlucose,
  onAddGlucose,
  canEdit,
  onEdit,
  canDischarge,
  canAdmit,
  onDischarge,
  onAdmit,
}: PatientBasicInfoProps) {
  const { token } = theme.useToken();

  // P2-6：菜单项按患者状态 + 权限收敛；全部不可用时整个下拉不渲染（裁定 6）。
  // 2026-11-26：「编辑患者信息」恒排首项（裁定 Q2，与列表页更多菜单一致），其后办理出院/住院
  const moreItems = useMemo<NonNullable<MenuProps['items']>>(() => {
    const items: NonNullable<MenuProps['items']> = [];
    if (canEdit) {
      items.push({ key: 'edit', label: '编辑患者信息' });
    }
    if (canDischarge) {
      items.push({ key: 'discharge', label: '办理出院' });
    }
    if (canAdmit) {
      items.push({ key: 'admit', label: '办理住院' });
    }
    return items;
  }, [canEdit, canDischarge, canAdmit]);

  const handleMoreClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'edit') {
      onEdit();
      return;
    }
    if (key === 'discharge') {
      onDischarge();
      return;
    }
    if (key === 'admit') {
      onAdmit();
    }
  };

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
      {/* 糖尿病类型（2026-11-26 需求规则 4）：年龄与入院时间之间，样式同姓名（加粗放大、只显示值）；
          住院/出院都展示（裁定 Q4）；null → 「-」（裁定 Q2，与其他字段空值口径一致） */}
      <span style={{ fontSize: token.fontSizeLG, fontWeight: 600, color: token.colorText }}>
        {detail.diabetesType ? DIABETES_TYPE_LABELS[detail.diabetesType] : '-'}
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

      {canAddGlucose || moreItems.length > 0 ? (
        <div
          style={{
            marginLeft: 'auto',
            alignSelf: 'flex-end',
            display: 'flex',
            alignItems: 'center',
            gap: token.marginXS,
          }}
        >
          {canAddGlucose ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={onAddGlucose}>
              添加血糖
            </Button>
          ) : null}
          {/* P2-6：「更多操作」下拉在"添加血糖"之后（裁定 Q3），hover 触发展示菜单 */}
          {moreItems.length > 0 ? (
            <Dropdown trigger={['hover']} menu={{ items: moreItems, onClick: handleMoreClick }}>
              <Button>
                更多操作 <DownOutlined />
              </Button>
            </Dropdown>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

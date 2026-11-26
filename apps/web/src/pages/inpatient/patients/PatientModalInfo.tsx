import { Col, Row, theme } from 'antd';

export interface PatientModalInfoItem {
  label: string;
  value: string | null | undefined;
  /** 时间/编号类值用 gc-num 等宽数字（UI 规范） */
  numeric?: boolean;
}

/**
 * 出院/办理住院弹框的患者基本信息展示（P2-6 裁定 1a/1b）。
 *
 * label:value 平铺、每行 2 项、缺失展示「-」；只读展示不走 Form，
 * 姓名一律用脱敏值（nameMasked），弹框不新增明文出口（规格 §5）。
 */
export default function PatientModalInfo({ items }: { items: PatientModalInfoItem[] }) {
  const { token } = theme.useToken();
  return (
    <Row gutter={[token.marginLG, token.marginSM]}>
      {items.map((item) => (
        <Col span={12} key={item.label}>
          <span style={{ color: token.colorTextTertiary }}>{item.label}：</span>
          <span className={item.numeric ? 'gc-num' : undefined} style={{ color: token.colorText }}>
            {item.value || '-'}
          </span>
        </Col>
      ))}
    </Row>
  );
}

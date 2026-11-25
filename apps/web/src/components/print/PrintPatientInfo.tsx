import type { PatientDetail } from '@gc/shared';
import { PRINT_STATUS_LABELS } from './printConstants';
import { formatPrintDay } from './paginate';
import { formatAge, getGenderLabel } from '@/pages/inpatient/patients/patient-format';

/**
 * R28 打印件第二部分：患者信息（docs/specs/glucose-print.md §4 规则 2）。
 *
 * 11 项按 label：value 展示，横向 4 组一行（CSS grid），label 区等宽右对齐使「：」纵向对齐；
 * 有则展示、无则展示 '-'（住院患者出院日期天然为 '-'）。
 * 姓名用**明文**（接口 GET /patients/:id/name-plain，访问即留痕）；
 * plainName 为 null（密文不可解/请求失败）时回退脱敏值（规格 §4 规则 15）。
 */

export interface PrintPatientInfoItem {
  label: string;
  value: string;
}

/** 构建 11 项患者信息（顺序即展示顺序，4 个一行）。导出仅为单测 */
export function buildPatientInfoItems(
  patient: PatientDetail,
  plainName: string | null,
): PrintPatientInfoItem[] {
  return [
    { label: '姓名', value: plainName ?? patient.nameMasked ?? '-' },
    { label: '性别', value: getGenderLabel(patient.gender) },
    { label: '年龄', value: formatAge(patient.age) },
    { label: '床号', value: patient.bedNo ?? '-' },
    { label: '住院号', value: patient.patientNo ?? '-' },
    { label: '科室', value: patient.departmentName ?? '-' },
    { label: '责任医生', value: patient.doctorName ?? '-' },
    { label: '责任护士', value: patient.nurseName ?? '-' },
    { label: '住院日期', value: formatPrintDay(patient.admissionAt) },
    { label: '出院日期', value: formatPrintDay(patient.dischargeAt) },
    { label: '状态', value: PRINT_STATUS_LABELS[patient.status] ?? '-' },
  ];
}

export default function PrintPatientInfo({
  patient,
  plainName,
}: {
  patient: PatientDetail;
  plainName: string | null;
}) {
  const items = buildPatientInfoItems(patient, plainName);
  return (
    <div className="gc-print-patient-info">
      {items.map((item) => (
        <div key={item.label} className="gc-print-patient-item">
          <span className="gc-print-patient-label">{item.label}</span>
          <span className="gc-print-patient-colon">：</span>
          <span className="gc-print-patient-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

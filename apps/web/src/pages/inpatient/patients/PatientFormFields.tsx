import { useMemo } from 'react';
import {
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  DATE_ONLY_FORMAT,
  DIABETES_TYPE,
  DIABETES_TYPE_LABELS,
  GENDER_LABELS,
  GENDER_SELECTABLE,
  HBA1C_MAX,
  HBA1C_MIN,
  HBA1C_UNIT,
  PATIENT_STATUS,
  PATIENT_STATUS_LABELS,
  ROLE_CODE,
} from '@gc/shared';
import type { DiabetesType, Gender, PatientStatus, RoleCode } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

/**
 * 患者表单字段（添加患者 / 编辑患者信息共用）。
 *
 * 为什么共用：需求要求「编辑弹框里的内容和添加患者弹框一致」，
 * 两份独立的 Form.Item 迟早出现校验规则漂移，所以统一到本组件，
 * 差异只由 mode 控制（新增 / 编辑的可编辑字段不同）。
 */

/** 可「清除」的敏感字段：姓名必填，只能改不能清，故不含 name */
export type SensitiveField = 'idCard' | 'phone';

export interface PatientFormValues {
  name: string;
  birthDate: Dayjs;
  bedNo?: string;
  phone?: string;
  doctorId?: string;
  diabetesType?: DiabetesType;
  hba1c?: number;
  gender: Gender;
  idCard?: string;
  patientNo: string;
  departmentId: string;
  nurseId?: string;
  admissionAt: Dayjs;
  status: PatientStatus;
}

interface PatientFormFieldsProps {
  form: FormInstance<PatientFormValues>;
  /** create：新增；edit：编辑（住院号/入院时间/状态只读，敏感字段显示脱敏提示） */
  mode: 'create' | 'edit';
  /** edit 模式：详情返回的脱敏值，用于「当前 xx，留空则不修改」提示 */
  masked?: {
    nameMasked: string | null;
    idCardMasked: string | null;
    phoneMasked: string | null;
  } | null;
  /** edit 模式：已标记清除的敏感字段，提交时置 null */
  clearedFields?: SensitiveField[];
  onToggleClear?: (field: SensitiveField) => void;
}

/** 责任护士候选角色：护士 + 护士长（与 DY-OPERATOR 口径一致） */
const NURSE_ROLE_CODES: RoleCode[] = [ROLE_CODE.NURSE, ROLE_CODE.HEAD_NURSE];

/** 按数据范围收敛科室下拉，避免选到无权的科室 */
function filterDepartments(
  departments: DepartmentOption[],
  dataScope: string | undefined,
  departmentId: string | undefined,
): DepartmentOption[] {
  if (dataScope === 'ALL') {
    return departments;
  }
  if (dataScope === 'NONE' || !departmentId) {
    return [];
  }
  return departments.filter((item) => item.id === departmentId);
}

/** 医护下拉：按科室联动，并限定角色 */
function filterStaff(staff: StaffOption[], departmentId: string | undefined, roles: RoleCode[]) {
  if (!departmentId) {
    return [];
  }
  return staff.filter(
    (item) =>
      item.departmentId === departmentId && roles.some((role) => item.roleCodes.includes(role)),
  );
}

/** 敏感字段下方的提示与「清除」入口（仅编辑模式） */
const hintStyle = { fontSize: 12 } as const;

export default function PatientFormFields({
  form,
  mode,
  masked,
  clearedFields = [],
  onToggleClear,
}: PatientFormFieldsProps) {
  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);

  const departmentId = Form.useWatch('departmentId', form);
  const isEdit = mode === 'edit';

  const departmentOptions = useMemo(
    () => filterDepartments(departments, profile?.dataScope, profile?.departmentId),
    [departments, profile?.dataScope, profile?.departmentId],
  );

  const doctorOptions = useMemo(
    () => filterStaff(staff, departmentId, [ROLE_CODE.DOCTOR]),
    [staff, departmentId],
  );

  const nurseOptions = useMemo(
    () => filterStaff(staff, departmentId, NURSE_ROLE_CODES),
    [staff, departmentId],
  );

  const handleDepartmentChange = (value: string) => {
    // 科室变更后，原责任医生/护士可能已不属于该科室，一律清空
    form.setFieldsValue({ departmentId: value, doctorId: undefined, nurseId: undefined });
  };

  /** 编辑模式：脱敏值提示 + 清除/取消清除 */
  const sensitiveExtra = (field: SensitiveField, maskedValue: string | null | undefined) => {
    if (!isEdit) {
      return undefined;
    }
    const cleared = clearedFields.includes(field);
    return (
      <Space size={6}>
        <Typography.Text type="secondary" style={hintStyle}>
          {cleared ? '保存后将清除原值' : `当前 ${maskedValue || '未填写'}，留空则不修改`}
        </Typography.Text>
        {maskedValue ? (
          <Button
            type="link"
            size="small"
            style={{ ...hintStyle, paddingInline: 0, height: 'auto' }}
            onClick={() => onToggleClear?.(field)}
          >
            {cleared ? '取消清除' : '清除'}
          </Button>
        ) : null}
      </Space>
    );
  };

  return (
    <Row gutter={24}>
      <Col span={12}>
        <Form.Item
          name="name"
          label="姓名"
          rules={isEdit ? undefined : [{ required: true, message: '请输入患者姓名' }]}
          extra={
            isEdit ? (
              <Typography.Text type="secondary" style={hintStyle}>
                当前 {masked?.nameMasked || '未填写'}，留空则不修改
              </Typography.Text>
            ) : undefined
          }
        >
          <Input
            placeholder={isEdit ? '留空则不修改姓名' : '请输入姓名'}
            maxLength={32}
            allowClear
          />
        </Form.Item>

        <Form.Item
          name="birthDate"
          label="出生日期"
          rules={[{ required: true, message: '请选择出生日期' }]}
        >
          <DatePicker
            style={{ width: '100%' }}
            format={DATE_ONLY_FORMAT}
            placeholder="请选择出生日期"
            disabledDate={(current) => current.isAfter(dayjs(), 'day')}
          />
        </Form.Item>

        <Form.Item name="bedNo" label="床号">
          <Input placeholder="请输入床号" maxLength={32} allowClear />
        </Form.Item>

        <Form.Item
          name="phone"
          label="手机号"
          rules={[{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' }]}
          extra={sensitiveExtra('phone', masked?.phoneMasked)}
        >
          <Input
            placeholder={isEdit ? '留空则不修改手机号' : '请输入手机号'}
            maxLength={11}
            allowClear
            disabled={isEdit && clearedFields.includes('phone')}
          />
        </Form.Item>

        <Form.Item name="doctorId" label="责任医生">
          <Select
            placeholder={departmentId ? '请选择责任医生' : '请先选择科室'}
            options={doctorOptions.map((item) => ({ value: item.id, label: item.name }))}
            disabled={!departmentId}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="diabetesType" label="糖尿病类型">
          <Select
            placeholder="请选择糖尿病类型"
            options={Object.values(DIABETES_TYPE).map((value) => ({
              value,
              label: DIABETES_TYPE_LABELS[value],
            }))}
            allowClear
          />
        </Form.Item>

        <Form.Item name="hba1c" label="糖化血红蛋白">
          <InputNumber
            style={{ width: '100%' }}
            min={HBA1C_MIN}
            max={HBA1C_MAX}
            step={0.1}
            precision={1}
            placeholder={`${HBA1C_MIN.toFixed(1)} ~ ${HBA1C_MAX.toFixed(1)}`}
            addonAfter={HBA1C_UNIT}
          />
        </Form.Item>
      </Col>

      <Col span={12}>
        <Form.Item name="gender" label="性别" rules={[{ required: true, message: '请选择性别' }]}>
          <Select
            placeholder="请选择性别"
            options={GENDER_SELECTABLE.map((value) => ({
              value,
              label: GENDER_LABELS[value],
            }))}
          />
        </Form.Item>

        <Form.Item
          name="idCard"
          label="身份证"
          rules={[{ pattern: /^\d{17}[\dXx]$/, message: '身份证号格式不正确' }]}
          extra={sensitiveExtra('idCard', masked?.idCardMasked)}
        >
          <Input
            placeholder={isEdit ? '留空则不修改身份证号' : '请输入身份证号'}
            maxLength={18}
            allowClear
            disabled={isEdit && clearedFields.includes('idCard')}
          />
        </Form.Item>

        <Form.Item
          name="patientNo"
          label="住院号"
          rules={[{ required: true, message: '请输入住院号' }]}
        >
          <Input placeholder="请输入住院号" maxLength={32} allowClear disabled={isEdit} />
        </Form.Item>

        <Form.Item
          name="departmentId"
          label="科室"
          rules={[{ required: true, message: '请选择科室' }]}
        >
          <Select
            placeholder="请选择科室"
            options={departmentOptions.map((item) => ({ value: item.id, label: item.name }))}
            onChange={handleDepartmentChange}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="nurseId" label="责任护士">
          <Select
            placeholder={departmentId ? '请选择责任护士' : '请先选择科室'}
            options={nurseOptions.map((item) => ({ value: item.id, label: item.name }))}
            disabled={!departmentId}
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item
          name="admissionAt"
          label="入院时间"
          rules={[{ required: true, message: '请选择入院时间' }]}
        >
          <DatePicker
            style={{ width: '100%' }}
            format="YYYY-MM-DD HH:mm"
            showTime={{ format: 'HH:mm' }}
            placeholder="请选择入院时间"
            disabled={isEdit}
          />
        </Form.Item>

        <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
          <Select
            disabled
            options={[
              {
                value: PATIENT_STATUS.INPATIENT,
                label: PATIENT_STATUS_LABELS[PATIENT_STATUS.INPATIENT],
              },
            ]}
          />
        </Form.Item>
      </Col>
    </Row>
  );
}

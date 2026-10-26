import { useEffect, useMemo, useState } from 'react';
import { Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, message } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  createPatientSchema,
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
import { ApiError } from '@/api/client';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import { createPatient, type CreatePatientPayload } from '@/api/patient';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

interface PatientCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** 建档成功后的回调（刷新列表） */
  onSuccess: () => void;
}

interface PatientFormValues {
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

/** 责任护士候选角色：护士 + 护士长（与 DY-OPERATOR 口径一致） */
const NURSE_ROLE_CODES: RoleCode[] = [ROLE_CODE.NURSE, ROLE_CODE.HEAD_NURSE];

/** 按数据范围收敛科室下拉，避免选到无权建档的科室 */
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

/** 表单值 → 接口传输格式：日期转字符串，空串转 undefined */
function toPayload(values: PatientFormValues): CreatePatientPayload {
  return {
    name: values.name.trim(),
    gender: values.gender,
    birthDate: values.birthDate.format(DATE_ONLY_FORMAT),
    patientNo: values.patientNo.trim(),
    departmentId: values.departmentId,
    // UI 只选到分钟，补 :00 对齐统一契约 YYYY-MM-DD HH:mm:ss
    admissionAt: `${values.admissionAt.format('YYYY-MM-DD HH:mm')}:00`,
    status: values.status,
    idCard: values.idCard?.trim() || undefined,
    phone: values.phone?.trim() || undefined,
    bedNo: values.bedNo?.trim() || undefined,
    doctorId: values.doctorId,
    nurseId: values.nurseId,
    diabetesType: values.diabetesType,
    hba1c: values.hba1c ?? undefined,
  };
}

export default function PatientCreateModal({ open, onClose, onSuccess }: PatientCreateModalProps) {
  const [form] = Form.useForm<PatientFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);

  const departmentId = Form.useWatch('departmentId', form);

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

  /** 打开时重置表单：入院时间取当前时刻，状态固定为住院患者 */
  useEffect(() => {
    if (!open) {
      return;
    }
    const defaultDepartmentId = departmentOptions.some((item) => item.id === profile?.departmentId)
      ? profile?.departmentId
      : undefined;
    form.resetFields();
    form.setFieldsValue({
      admissionAt: dayjs(),
      status: PATIENT_STATUS.INPATIENT,
      departmentId: defaultDepartmentId,
    });
  }, [open, form, departmentOptions, profile?.departmentId]);

  const handleDepartmentChange = (value: string) => {
    // 科室变更后，原责任医生/护士可能已不属于该科室，一律清空
    form.setFieldsValue({ departmentId: value, doctorId: undefined, nurseId: undefined });
  };

  const handleSubmit = async () => {
    let values: PatientFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload = toPayload(values);
    // 与后端复用同一份 Zod 契约，避免前端规则与接口校验不一致
    const parsed = createPatientSchema.safeParse(payload);
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.map((issue) => ({
          name: issue.path[0] as keyof PatientFormValues,
          errors: [issue.message],
        })),
      );
      return;
    }

    setSubmitting(true);
    try {
      await createPatient(payload);
      void message.success('患者添加成功');
      onSuccess();
      onClose();
    } catch (error) {
      // 字段级校验错误（10001）挂到表单项；其余错误由请求拦截器统一提示
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((detail) => ({
            name: detail.field as keyof PatientFormValues,
            errors: [detail.message],
          })),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="添加患者"
      width={760}
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      <Form form={form} layout="vertical" preserve={false} requiredMark>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="姓名"
              rules={[{ required: true, message: '请输入患者姓名' }]}
            >
              <Input placeholder="请输入姓名" maxLength={32} allowClear />
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
            >
              <Input placeholder="请输入手机号" maxLength={11} allowClear />
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
            <Form.Item
              name="gender"
              label="性别"
              rules={[{ required: true, message: '请选择性别' }]}
            >
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
            >
              <Input placeholder="请输入身份证号" maxLength={18} allowClear />
            </Form.Item>

            <Form.Item
              name="patientNo"
              label="住院号"
              rules={[{ required: true, message: '请输入住院号' }]}
            >
              <Input placeholder="请输入住院号" maxLength={32} allowClear />
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
              />
            </Form.Item>

            <Form.Item
              name="status"
              label="状态"
              rules={[{ required: true, message: '请选择状态' }]}
              extra="本期建档只支持住院患者，出院流转由后续出院操作产生"
            >
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
      </Form>
    </Modal>
  );
}

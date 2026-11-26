import { useEffect, useMemo, useState } from 'react';
import { Form, Input, Modal, Select, Spin, message } from 'antd';
import dayjs from 'dayjs';
import { admitPatientSchema, ROLE_CODE } from '@gc/shared';
import type { PatientAdmitResult, PatientDetail } from '@gc/shared';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import { admitPatient, fetchPatientDetail } from '@/api/patient';
import PatientModalInfo from './PatientModalInfo';
import { getGenderLabel } from './patient-format';
import { filterDepartments, filterStaff, NURSE_ROLE_CODES } from './patient-form-options';

/** 入院时间预览格式（裁定 1b：展示当前日期时间，落库为服务端 now） */
const ADMIT_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

interface AdmitFormValues {
  departmentId: string;
  doctorId?: string;
  nurseId?: string;
  patientNo: string;
  bedNo?: string;
}

interface PatientAdmitModalProps {
  /** null 表示未选中患者，弹框不打开 */
  patientId: string | null;
  /** 详情页打开时复用已加载的详情；列表（出院 Tab）入口不传，由弹框内拉取 */
  prefetchedDetail?: PatientDetail | null;
  open: boolean;
  onClose: () => void;
  /** 住院成功回调（成功提示已在弹框内给出），父页面只负责刷新 */
  onSuccess: (result: PatientAdmitResult) => void;
}

/**
 * 办理住院弹框（P2-6 契约升级，docs/specs/patient-discharge.md §6）。
 *
 * 姓名/性别/出生日期只读展示；科室/责任医生/责任护士下拉的展示逻辑与
 * 数据源同添加患者弹框（patient-form-options 公共模块，裁定 1b）；
 * 住院号必填、床号选填，均回填当前值可改（覆盖式提交，裁定 4 变更记录）。
 */
export default function PatientAdmitModal({
  patientId,
  prefetchedDetail,
  open,
  onClose,
  onSuccess,
}: PatientAdmitModalProps) {
  const [form] = Form.useForm<AdmitFormValues>();
  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);
  const staff = useCommonDataStore((state) => state.staff);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 入院时间预览：打开弹框时刻定格（落库值以服务端 now 为准） */
  const [admitPreview, setAdmitPreview] = useState('');

  /**
   * 详情页入口：prefetchedDetail 同步可用（信息区立即渲染，不等 effect）；
   * 列表入口：走 effect 拉取，结果存 detail。表单回填统一在 effect 里做。
   */
  const displayDetail =
    prefetchedDetail && prefetchedDetail.id === patientId ? prefetchedDetail : detail;

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

  useEffect(() => {
    if (!open || !patientId) {
      return;
    }
    setAdmitPreview(dayjs().format(ADMIT_TIME_FORMAT));
    form.resetFields();

    const fill = (data: PatientDetail) => {
      setDetail(data);
      // 回填患者当前值（可改）；医护/床号空值回 undefined 走 placeholder
      form.setFieldsValue({
        departmentId: data.departmentId,
        doctorId: data.doctorId ?? undefined,
        nurseId: data.nurseId ?? undefined,
        patientNo: data.patientNo ?? '',
        bedNo: data.bedNo ?? undefined,
      });
    };

    if (prefetchedDetail && prefetchedDetail.id === patientId) {
      fill(prefetchedDetail);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    fetchPatientDetail(patientId)
      .then((data) => {
        if (!cancelled) {
          fill(data);
        }
      })
      .catch(() => {
        // 错误提示由请求拦截器统一处理
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId, prefetchedDetail, form]);

  const handleDepartmentChange = (value: string) => {
    // 科室变更后，原责任医生/护士可能已不属于该科室，一律清空（同添加患者弹框）
    form.setFieldsValue({ departmentId: value, doctorId: undefined, nurseId: undefined });
  };

  const handleSubmit = async () => {
    if (!displayDetail) {
      return;
    }
    let values: AdmitFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    // 与后端复用同一份 Zod 契约；医护/床号清空 = undefined（服务端覆盖为 NULL）
    const parsed = admitPatientSchema.safeParse({
      departmentId: values.departmentId,
      doctorId: values.doctorId,
      nurseId: values.nurseId,
      patientNo: values.patientNo.trim(),
      bedNo: values.bedNo?.trim() || undefined,
    });
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.map((issue) => ({
          name: issue.path[0] as keyof AdmitFormValues,
          errors: [issue.message],
        })),
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await admitPatient(displayDetail.id, parsed.data);
      void message.success('已办理住院');
      onSuccess(result);
      onClose();
    } catch (error) {
      // 字段级校验错误（10001）挂到表单项；其余由拦截器统一提示，弹框不关闭
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((item) => ({
            name: item.field as keyof AdmitFormValues,
            errors: [item.message],
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
      title="办理住院"
      width={560}
      okText="办理住院"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || !displayDetail }}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      <Spin spinning={loading}>
        {displayDetail ? (
          <PatientModalInfo
            items={[
              { label: '姓名', value: displayDetail.nameMasked },
              { label: '性别', value: getGenderLabel(displayDetail.gender) },
              { label: '出生日期', value: displayDetail.birthDate, numeric: true },
              { label: '入院时间', value: admitPreview, numeric: true },
            ]}
          />
        ) : (
          <div style={{ minHeight: 64 }} />
        )}
        {/* Form 常驻渲染（不随 detail 条件挂载），避免 resetFields/setFieldsValue 报未连接警告 */}
        <Form form={form} layout="vertical" preserve={false} requiredMark style={{ marginTop: 16 }}>
          <Form.Item
            name="departmentId"
            label="科室"
            rules={[{ required: true, message: '请选择科室' }]}
          >
            <Select
              placeholder="请选择"
              onChange={handleDepartmentChange}
              options={departmentOptions.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="doctorId" label="责任医生">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={departmentId ? '请选择责任医生' : '请先选择科室'}
              disabled={!departmentId}
              options={doctorOptions.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="nurseId" label="责任护士">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={departmentId ? '请选择责任护士' : '请先选择科室'}
              disabled={!departmentId}
              options={nurseOptions.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item
            name="patientNo"
            label="住院号"
            rules={[{ required: true, message: '请输入住院号' }]}
          >
            <Input maxLength={32} placeholder="请输入" />
          </Form.Item>
          <Form.Item name="bedNo" label="床号">
            <Input maxLength={32} placeholder="请输入" />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}

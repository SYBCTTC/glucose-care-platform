import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Form, Modal, Spin, message, theme } from 'antd';
import dayjs from 'dayjs';
import {
  createGlucoseSchema,
  DATE_TIME_FORMAT,
  DICT_TYPE,
  GLUCOSE_ENTRY_DETECT,
  GLUCOSE_UNIT,
  isGlucoseValueResult,
  PERMISSION,
} from '@gc/shared';
import type { DictItemOption, GlucoseRecordDetail, TimeSlotOption } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchGlucoseDetail, updateGlucose, voidGlucose } from '@/api/glucose';
import GlucoseFormFields, {
  toPayload,
  type GlucoseFormValues,
} from '@/components/glucose/GlucoseFormFields';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

/** review 模式的一行：`<label>：<value>`（值可带字典色） */
export interface ReviewField {
  label: string;
  value: string;
  /** 字典色（仅血糖值行使用） */
  color?: string;
}

/**
 * 组装 review 模式字段（纯函数，单测见 GlucoseReviewModal.spec.tsx）。
 * 口径（R25 裁定 Q13 / 规格 §6.4）：
 * - 血糖值：数值型（0/1/2）显示 `x.x mmol/L`；非数值型（3~9）显示字典标签；均按字典色着色
 * - 检测时段：按 code 查动态时段名（含停用项回显）；查不到回退 code；空值 `-`
 * - 入录方式：固定文案「手动入录」——当前无 channel 字段（AGENTS.md §4.5），纯展示不落库
 * - 空值一律 `-`
 */
export function buildReviewFields(
  detail: GlucoseRecordDetail,
  resultTypes: DictItemOption[],
  timeSlots: TimeSlotOption[],
): ReviewField[] {
  const dict = resultTypes.find((item) => item.code === detail.resultType);
  const numeric = isGlucoseValueResult(detail.resultType);
  const valueText = numeric
    ? detail.valueMmolL === null
      ? '-'
      : `${detail.valueMmolL.toFixed(1)} ${GLUCOSE_UNIT}`
    : (dict?.label ?? detail.resultType);
  const slotName = detail.mealContext
    ? (timeSlots.find((slot) => slot.code === detail.mealContext)?.name ?? detail.mealContext)
    : '-';
  return [
    { label: '检测时间', value: detail.measuredAt || '-' },
    { label: '检测时段', value: slotName },
    { label: '血糖值', value: valueText, color: dict?.color ?? undefined },
    { label: '试纸', value: detail.testStrip === null ? '-' : String(detail.testStrip) },
    { label: '记录者', value: detail.operatorName ?? '-' },
    { label: '入录方式', value: '手动入录' },
    { label: '备注', value: detail.remark?.trim() ? detail.remark.trim() : '-' },
  ];
}

interface GlucoseReviewModalProps {
  /** 患者摘要（标题显示脱敏姓名）；null 表示关闭 */
  patient: { id: string; nameMasked: string } | null;
  /** 目标血糖记录 id；null 表示关闭 */
  recordId: string | null;
  onClose: () => void;
  /** 编辑/作废成功（或发现记录已失效）后回调：壳层版本号 +1 → 报表重拉 */
  onChanged: () => void;
}

/**
 * R25：血糖 review / 编辑弹框（点击报表单元格记录打开）。
 *
 * - **review 模式**（默认）：`label：value` 只读展示，按钮 = 取消 / 编辑（`glucose:update` 权限，裁定 Q9：
 *   无编辑权限者仍可点开只读查看）；
 * - **编辑模式**：字段与添加弹框一致（无「入录方式」），数据回填，按钮 = 删除 / 取消 / 保存；
 *   删除（`glucose:delete` 权限，仅护士长/系管）需二次确认，实现是**作废**（软删除，裁定 Q1a/Q2 文案）；
 * - 记录不存在/已作废（41001）或并发冲突（10008）：拦截器 toast 后关闭弹框并刷新报表。
 */
export default function GlucoseReviewModal({
  patient,
  recordId,
  onClose,
  onChanged,
}: GlucoseReviewModalProps) {
  const [form] = Form.useForm<GlucoseFormValues>();
  const { token } = theme.useToken();
  const [detail, setDetail] = useState<GlucoseRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'review' | 'edit'>('review');
  const [submitting, setSubmitting] = useState(false);

  const hasPermission = useAuthStore((state) => state.hasPermission);
  const profile = useAuthStore((state) => state.profile);
  const dicts = useCommonDataStore((state) => state.dicts);
  const timeSlots = useCommonDataStore((state) => state.timeSlots);

  // 回调进 ref：effect 只依赖 patientId/recordId，避免父层内联函数导致反复重拉
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const patientId = patient?.id;
  const open = patientId !== undefined && recordId !== null;

  useEffect(() => {
    if (!patientId || !recordId) {
      setDetail(null);
      setMode('review');
      return;
    }
    let cancelled = false;
    setMode('review');
    setDetail(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await fetchGlucoseDetail(patientId, recordId);
        if (!cancelled) {
          setDetail(result);
        }
      } catch {
        // 拦截器已按错误码提示（41001/10008/30002…）；记录可能已被他人作废 → 刷新报表并关闭
        if (!cancelled) {
          onChangedRef.current();
          onCloseRef.current();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, recordId]);

  /** 进入编辑模式：按详情回填表单（结果类型 0/1/2 归并为「检测」，与添加口径一致） */
  const enterEdit = useCallback(() => {
    if (!detail) {
      return;
    }
    form.resetFields();
    form.setFieldsValue({
      measuredAt: dayjs(detail.measuredAt, DATE_TIME_FORMAT),
      resultType: isGlucoseValueResult(detail.resultType)
        ? GLUCOSE_ENTRY_DETECT
        : detail.resultType,
      valueMmolL: detail.valueMmolL,
      testStrip: detail.testStrip,
      remark: detail.remark ?? undefined,
      // 历史数据 mealContext/operatorId 可能为空（库字段可空）：不回填，required 校验强制用户选择
      ...(detail.mealContext ? { mealContext: detail.mealContext } : {}),
      ...(detail.operatorId ?? profile?.userId
        ? { operatorId: detail.operatorId ?? (profile?.userId as string) }
        : {}),
    });
    setMode('edit');
  }, [detail, form, profile?.userId]);

  const handleSave = useCallback(async () => {
    if (!patientId || !recordId) {
      return;
    }
    let values: GlucoseFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload = toPayload(values);
    // 与后端复用同一份 Zod 契约（编辑请求体 = 添加请求体）
    const parsed = createGlucoseSchema.safeParse(payload);
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.map((issue) => ({
          name: issue.path[0] as keyof GlucoseFormValues,
          errors: [issue.message],
        })),
      );
      return;
    }
    setSubmitting(true);
    try {
      await updateGlucose(patientId, recordId, payload);
      void message.success('血糖记录已更新');
      onChangedRef.current();
      onCloseRef.current();
    } catch (error) {
      // 41003（撞检测时间）/10001 字段级挂表单项；10008/41001 拦截器 toast 后刷新并关闭
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((detailItem) => ({
            name: detailItem.field as keyof GlucoseFormValues,
            errors: [detailItem.message],
          })),
        );
      } else if (error instanceof ApiError) {
        onChangedRef.current();
        onCloseRef.current();
      }
    } finally {
      setSubmitting(false);
    }
  }, [form, patientId, recordId]);

  const handleVoid = useCallback(() => {
    if (!patientId || !recordId) {
      return;
    }
    Modal.confirm({
      title: '确认作废该条血糖记录？',
      content: '作废后报表将不再展示（裁定 Q2 文案；医疗记录不物理删除，作废操作留审计痕迹）。',
      okText: '确认作废',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await voidGlucose(patientId, recordId);
          void message.success('血糖记录已作废');
          onChangedRef.current();
          onCloseRef.current();
        } catch {
          // 拦截器已提示（10008 并发/41001 不存在/30004 无权限）；状态可能已变 → 刷新报表并关闭
          onChangedRef.current();
          onCloseRef.current();
        }
      },
    });
  }, [patientId, recordId]);

  const canUpdate = hasPermission(PERMISSION.GLUCOSE_UPDATE);
  const canDelete = hasPermission(PERMISSION.GLUCOSE_DELETE);
  const resultTypes = dicts[DICT_TYPE.GLUCOSE_RESULT] ?? [];

  const reviewFields = detail ? buildReviewFields(detail, resultTypes, timeSlots) : [];

  const footer =
    mode === 'review'
      ? [
          <Button key="cancel" onClick={onClose}>
            取消
          </Button>,
          // 裁定 Q9：无 glucose:update 权限 → 只读 review（前端隐藏只是体验，服务端才是边界）
          ...(canUpdate
            ? [
                <Button key="edit" type="primary" disabled={!detail} onClick={enterEdit}>
                  编辑
                </Button>,
              ]
            : []),
        ]
      : [
          // 裁定 Q8：删除（作废）仅护士长/系统管理员可见
          ...(canDelete
            ? [
                <Button key="void" danger disabled={submitting} onClick={handleVoid}>
                  删除
                </Button>,
              ]
            : []),
          <Button key="cancel" disabled={submitting} onClick={onClose}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={submitting}
            onClick={() => {
              void handleSave();
            }}
          >
            保存
          </Button>,
        ];

  return (
    <Modal
      open={open}
      title={`${mode === 'review' ? '血糖记录' : '编辑血糖'} · ${patient?.nameMasked ?? ''}`}
      width={560}
      footer={footer}
      onCancel={onClose}
      maskClosable={false}
    >
      {loading || !detail ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: token.paddingXL }}>
          <Spin />
        </div>
      ) : mode === 'review' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
          {reviewFields.map((field) => (
            <div key={field.label} style={{ display: 'flex', gap: token.marginXS }}>
              <span
                style={{
                  flex: '0 0 96px',
                  color: token.colorTextSecondary,
                  fontWeight: token.fontWeightStrong,
                }}
              >
                {field.label}：
              </span>
              <span
                style={{
                  flex: 1,
                  color: field.color ?? token.colorText,
                  fontWeight: field.color ? token.fontWeightStrong : undefined,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {field.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ flex: '120px' }}
          wrapperCol={{ flex: '1 1 0' }}
          requiredMark
        >
          {/* 编辑模式不提供时段自动推荐（记录已有时段，改时间不应悄悄改掉它） */}
          <GlucoseFormFields form={form} />
        </Form>
      )}
    </Modal>
  );
}

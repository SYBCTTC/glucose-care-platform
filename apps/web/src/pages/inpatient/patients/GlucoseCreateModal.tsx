import { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Modal, message } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { createGlucoseSchema, GLUCOSE_ENTRY_DETECT, pickTimeSlotByTime } from '@gc/shared';
import type { GlucoseCreateResult } from '@gc/shared';
import { ApiError } from '@/api/client';
import { createGlucose } from '@/api/glucose';
import GlucoseFormFields, {
  toPayload,
  type GlucoseFormValues,
} from '@/components/glucose/GlucoseFormFields';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

interface GlucoseCreateModalProps {
  /**
   * 目标患者；null 表示关闭。
   * R25 起放宽为摘要形状（标题只用脱敏姓名、提交只用 id）：
   * 患者列表/详情壳传完整 `PatientListItem`/`PatientDetail`，报表子路由传 context 下发的摘要。
   */
  patient: { id: string; nameMasked: string } | null;
  open: boolean;
  /**
   * R25：预填（报表空白格点击触发）——`measuredAt` = 行日期 + 当前时分秒（裁定 Q15）、
   * `mealContext` = 该列时段 code，且视为「已手动选择」，不被按时间自动推荐覆盖（裁定 Q16 口径）。
   * 不传（列表页/详情壳入口）时保持原默认行为：当前时刻 + 自动推荐时段。
   * ⚠️ 传入对象需引用稳定（父层用 state 持有），否则打开期间 effect 会反复重置表单。
   */
  prefill?: { measuredAt: Dayjs; mealContext: string } | null;
  onClose: () => void;
  /** 录入成功回调：带回更新后的列表项，供页面替换该行 */
  onSuccess: (result: GlucoseCreateResult) => void;
}

/**
 * 添加血糖弹窗（住院患者）。
 * 表单字段组已抽取为 `GlucoseFormFields`（R25，与编辑弹框复用），本组件只保留：
 * 打开重置/预填、时段自动推荐（touched 语义）、提交与幂等/字段级错误处理、Modal 壳。
 */
export default function GlucoseCreateModal({
  patient,
  open,
  prefill,
  onClose,
  onSuccess,
}: GlucoseCreateModalProps) {
  const [form] = Form.useForm<GlucoseFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const profile = useAuthStore((state) => state.profile);
  const timeSlots = useCommonDataStore((state) => state.timeSlots);
  /** 用户是否手动改过检测时段：改过就不再被「按检测时间自动选中」覆盖 */
  const mealContextTouched = useRef(false);

  /**
   * 检测时段默认值：按检测时间落入的普通时段自动选中（区间左闭右开，见 pickTimeSlotByTime）。
   * 用户手动选过时段后不再覆盖；R25 预填（空白格点击）在打开时即置 touched，同样不被覆盖。
   */
  const applyTimeSlotByMeasuredAt = useCallback(
    (value: Dayjs | null | undefined) => {
      if (!value || mealContextTouched.current) {
        return;
      }
      const slot = pickTimeSlotByTime(timeSlots, value.format('HH:mm'));
      if (slot) {
        form.setFieldsValue({ mealContext: slot.code });
      }
    },
    [form, timeSlots],
  );

  /**
   * 打开时重置：检测时间取当前时刻、结果类型默认「检测」、记录者默认当前账号。
   * 检测时段由下面的 effect 按检测时间自动选中。
   * R25：带 prefill 打开时改用预填值（日期+时段已知，用户无需重复选择），并视为已手动选择。
   *
   * 注意不要给 Form 加 preserve={false}：Modal 的 body 在首帧后会再挂载一次，
   * 非保留字段在 Form 卸载时会被 destroyForm 清空，导致这里写入的默认值在首帧渲染时被抹掉
   * （表现为首次打开时全部为空、血糖值/试纸置灰）。关闭时不清空也无妨：每次打开都会重置。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    mealContextTouched.current = prefill !== undefined && prefill !== null;
    form.resetFields();
    form.setFieldsValue({
      measuredAt: prefill?.measuredAt ?? dayjs(),
      resultType: GLUCOSE_ENTRY_DETECT,
      operatorId: profile?.userId,
      ...(prefill ? { mealContext: prefill.mealContext } : {}),
    });
  }, [open, form, profile?.userId, prefill]);

  /**
   * 检测时段默认值。公共数据可能晚于弹窗到达（timeSlots 变化会再次触发），
   * 所以不能只在打开时算一次；用户手动选过之后 applyTimeSlotByMeasuredAt 内部会自动跳过。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    applyTimeSlotByMeasuredAt(form.getFieldValue('measuredAt') as Dayjs | undefined);
  }, [open, applyTimeSlotByMeasuredAt, form]);

  const handleMealContextManualSelect = useCallback(() => {
    mealContextTouched.current = true;
  }, []);

  const handleSubmit = async () => {
    if (!patient) {
      return;
    }

    let values: GlucoseFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload = toPayload(values);
    // 与后端复用同一份 Zod 契约，避免前端规则与接口校验不一致
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
      const result = await createGlucose(patient.id, payload);
      if (result.skipped) {
        // 唯一约束兜底：该检测时间已有记录，本次未落库，不能提示"添加成功"
        void message.warning('该检测时间已有血糖记录，本次未重复保存');
      } else {
        void message.success('血糖添加成功');
      }
      onSuccess(result);
      onClose();
    } catch (error) {
      // 字段级校验错误（10001）挂到表单项；其余错误由请求拦截器统一提示
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((detail) => ({
            name: detail.field as keyof GlucoseFormValues,
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
      title={patient ? `添加血糖 · ${patient.nameMasked}` : '添加血糖'}
      width={560}
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      {/* 与患者弹框一致：label 与控件同行，label 定宽保证各行控件左边缘对齐 */}
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ flex: '120px' }}
        wrapperCol={{ flex: '1 1 0' }}
        requiredMark
      >
        <GlucoseFormFields
          form={form}
          onMeasuredAtChange={applyTimeSlotByMeasuredAt}
          onMealContextManualSelect={handleMealContextManualSelect}
        />
      </Form>
    </Modal>
  );
}

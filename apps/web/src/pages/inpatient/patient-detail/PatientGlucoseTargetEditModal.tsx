import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Col,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Tooltip,
  message,
  theme,
} from 'antd';
import type { FormInstance } from 'antd';
import {
  GLUCOSE_VALUE_MAX,
  GLUCOSE_VALUE_MIN,
  updatePatientGlucoseTargetsSchema,
} from '@gc/shared';
import type { PatientGlucoseTargetsResponse } from '@gc/shared';
import { ApiError } from '@/api/client';
import { updatePatientGlucoseTargets } from '@/api/patient';
import {
  TARGET_UNIT,
  buildDefaultFormValues,
  buildTargetFormValues,
  buildTargetPayload,
  canRestoreDefault,
  isTargetFormDirty,
  parseFieldPath,
  type TargetFormValues,
} from './glucose-target-view';

/** 数值输入框统一参数（规格 §6.3）：0.6~33.3、1 位小数、步进 0.1 */
const INPUT_STEP = 0.1;
const INPUT_PRECISION = 1;
/** 时段名列宽：容纳「早餐后」等四字时段名 + 全角冒号，与预警值行的 label 对齐 */
const LABEL_WIDTH = 92;

/**
 * antd 泛型化 `FormInstance<T>` 的 `setFields` 只接受**字面量** name 联合
 * （如 `['targets', number, 'valueDown']`），而 Zod 的 `issue.path` 与后端 `details.field`
 * 都是运行时才知道的动态路径（`(string | number)[]`），类型上无法直接对接。
 * 这里取 antd 自己的字段错误类型做一次断言，把「动态路径」的类型边界收敛到这一处
 * （同 `GlucoseCreateModal` 用 `as keyof GlucoseFormValues` 的处理思路）。
 */
type TargetFieldError = Parameters<FormInstance<TargetFormValues>['setFields']>[0][number];

interface PatientGlucoseTargetEditModalProps {
  open: boolean;
  patientId: string | undefined;
  /** 展示集合 + 默认值（来自 GET 响应）；null 时弹框不渲染表单 */
  data: PatientGlucoseTargetsResponse | null;
  /** 标题用的脱敏姓名（与「添加血糖」弹框同口径，不展示明文） */
  patientName: string;
  onClose: () => void;
  /**
   * 保存成功、或提交遇到**非字段级**错误（并发 / 状态 / 越权）时调用。
   * 两种情况都需要父层重新 GET：前者要展示新值，后者说明弹框里的数据已过期。
   */
  onChanged: () => void;
}

/**
 * 编辑患者控糖目标弹框（规格 §6.3，裁定 J / Q / S / V）。
 *
 * 布局：时段**两个一行**（`Col span={12}`），每行 `时段名：<下限> ~ <上限> mmol/L`；
 * 8 个时段排完后**另起一行**放低 / 高血糖预警值（同样两个一行）。
 *
 * 三个附加交互（裁定 S）：
 *  1. 「恢复默认」→ 重置为接口下发的 `default*`（`TimeSlot` + `SystemConfig` 当前值），
 *     **仅重置表单、仍需点保存才落库**；带 `Popconfirm` 二次确认（会覆盖已填值）。
 *     全局阈值缺失（`default*` 为 null）时整体置灰 + tooltip 说明（裁定 Q）。
 *  2. 有未保存改动时点取消 / 关闭 → 二次确认。
 *  3. 保存前先走共享 Zod 契约 `safeParse`，失败用 `form.setFields` 落**字段级**红字。
 *
 * ⚠️ 确认框必须用 `Modal.useModal()` 而非静态 `Modal.confirm`：主题（暗色 + 字号档）由
 * `App.tsx` 的 `ConfigProvider` 下发，静态方法渲染在 React 树之外拿不到上下文，
 * 暗色模式下会弹出白底对话框（同 `WardMoreActions.tsx` / `patients/index.tsx` 的既有约定）。
 */
export default function PatientGlucoseTargetEditModal({
  open,
  patientId,
  data,
  patientName,
  onClose,
  onChanged,
}: PatientGlucoseTargetEditModalProps) {
  const [form] = Form.useForm<TargetFormValues>();
  const [modal, contextHolder] = Modal.useModal();
  const { token } = theme.useToken();
  const [submitting, setSubmitting] = useState(false);
  /** 打开时的表单快照，用于「是否有未保存改动」判断（裁定 S 交互 2） */
  const originalRef = useRef<TargetFormValues | null>(null);
  /** 本次打开是否已回填：避免父层 data 引用变化时覆盖医护正在输入的值 */
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      originalRef.current = null;
      return;
    }
    if (!data || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const initial = buildTargetFormValues(data);
    // 不加 preserve={false}：Modal body 首帧后会再挂载一次，非保留字段会被 destroyForm 清空
    // （同 GlucoseCreateModal 的既有踩坑记录）。关闭时不清空也无妨，每次打开都会重新回填。
    form.resetFields();
    form.setFieldsValue(initial);
    originalRef.current = initial;
  }, [open, data, form]);

  const canRestore = canRestoreDefault(data);

  const handleRestoreDefault = (): void => {
    if (!data) {
      return;
    }
    // 清掉上一次校验留下的红字：恢复默认填入的是合法值，残留错误会让医护以为还没改对。
    // 用 resetFields + setFieldsValue 组合，而不是逐个字段 setFields({ errors: [] })：
    //  - 本仓 antd 版本的 FormInstance 未暴露 clearValidate（TS2339）；
    //  - 枚举式 setFields 会触发 rc-field-form 的 "There may be circular references" 警告
    //    （已实测复现），且字段清单要跟着展示集合动态维护，容易漏。
    // resetFields 把值与校验态一起清空，随后 setFieldsValue 填入默认值即可。
    form.resetFields();
    form.setFieldsValue(buildDefaultFormValues(data));
    // 注意 originalRef 保持「打开时的库中值」不变：恢复默认只改表单，
    // 医护此时点取消仍会被提示「修改尚未保存」（默认值确实与库里不一致）
  };

  const handleCancel = (): void => {
    const original = originalRef.current;
    const current = form.getFieldsValue(true) as TargetFormValues;
    if (original && isTargetFormDirty(current, original)) {
      modal.confirm({
        title: '修改尚未保存，确定离开？',
        content: '离开后本次填写的控糖目标不会被保存。',
        okText: '确定离开',
        cancelText: '继续编辑',
        onOk: onClose,
      });
      return;
    }
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!patientId || !data) {
      return;
    }
    const values = form.getFieldsValue(true) as TargetFormValues;
    const payload = buildTargetPayload(values, data);

    // 与后端复用同一份 Zod 契约，避免前端规则与接口校验不一致（同 GlucoseCreateModal）
    const parsed = updatePatientGlucoseTargetsSchema.safeParse(payload);
    if (!parsed.success) {
      // issue.path 形如 ['targets', 0, 'valueDown']，与 Form.Item 的 name 数组同构，可直接使用
      const issues = parsed.error.issues
        .filter((issue) => issue.path.length > 0)
        .map((issue) => ({ name: issue.path, errors: [issue.message] }));
      form.setFields(issues as TargetFieldError[]);
      return;
    }

    setSubmitting(true);
    try {
      await updatePatientGlucoseTargets(patientId, payload);
      void message.success('控糖目标已保存');
      onChanged();
      onClose();
    } catch (error) {
      // 字段级校验错误（10001，ERROR_CODE_META 的 action='field'）：拦截器**不弹**全局提示，
      // 由本弹框把 details 映射到输入框并保持打开，让医护就地改正。
      // field 是 `targets[0].valueDown` 这类混合写法，须经 parseFieldPath 转成数组下标形式。
      if (error instanceof ApiError && error.details?.length) {
        const details = error.details
          .map((detail) => ({ name: parseFieldPath(detail.field), errors: [detail.message] }))
          // 解析不出路径的错误宁可丢弃，也不能挂到根表单或错误的输入框上误导医护
          .filter((field) => field.name.length > 0);
        form.setFields(details as TargetFieldError[]);
        return;
      }
      // 其余错误（并发 10008 / 非在院 40004 / 越权 30002 / 患者不存在 40001）：
      // 拦截器已按 ERROR_CODE_META 统一提示（toast / toast-refresh），本弹框的数据已不可信
      // → 关闭并让父层重新 GET，医护基于最新状态重新判断（例如患者刚办理出院）。
      onChanged();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  /** 时段行 / 预警值行共用的 label 样式：定宽保证各行输入框左边缘对齐（同既有弹框约定） */
  const labelStyle = {
    flex: `0 0 ${LABEL_WIDTH}px`,
    height: token.controlHeight,
    display: 'flex',
    alignItems: 'center',
    color: token.colorTextSecondary,
  } as const;

  /**
   * 时段行「~」分隔符样式（**不可复用 `labelStyle`**）。
   *
   * `labelStyle` 的 `flex: 0 0 92px` 是为容纳「低血糖预警：」这类六字 label 预留的定宽；
   * 套在只有一个字符的「~」上会白占 92px。时段行一行要塞「label + 下限 + ~ + 上限 + 单位」五段，
   * 在 760 宽弹框的半栏（约 344px）里，这 92px 会把两个 `flex: 1` 的输入框各挤到约 47px ——
   * 而 `InputNumber` 聚焦/悬停时右侧还要显示步进按钮（约 22px），加上左右内边距后
   * 留给数字的宽度不足 25px，连「33.3」都会被裁切，这正是「聚焦后看不清数字」的成因。
   *
   * 改为 `flex: none`（宽度只取字符本身）+ **左右等值**内边距：容器 `gap` 两侧本就相同，
   * 故「~」与左右输入框严格等距；腾出的约 76px 全部还给两个输入框（各约 85px，宽度近乎翻倍）。
   * 预警值行一行只有一个输入框、不存在该挤压问题，故保持原样不动。
   */
  const separatorStyle = {
    flex: 'none',
    height: token.controlHeight,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `0 ${token.marginXXS}px`,
    color: token.colorTextSecondary,
  } as const;

  const numberProps = {
    style: { width: '100%' },
    min: GLUCOSE_VALUE_MIN,
    max: GLUCOSE_VALUE_MAX,
    step: INPUT_STEP,
    precision: INPUT_PRECISION,
    placeholder: `${GLUCOSE_VALUE_MIN} ~ ${GLUCOSE_VALUE_MAX}`,
  } as const;

  return (
    <Modal
      open={open}
      title={patientName ? `编辑控糖目标 · ${patientName}` : '编辑控糖目标'}
      width={760}
      maskClosable={false}
      // 走自定义 footer（左侧「恢复默认」+ 右侧取消/保存），故不用 onOk/okText
      onCancel={handleCancel}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {canRestore ? (
            <Popconfirm
              title="恢复为系统默认值？"
              description="将覆盖当前已填写的全部数值，仍需点「保存」才会生效。"
              okText="恢复"
              cancelText="取消"
              onConfirm={handleRestoreDefault}
            >
              <Button>恢复默认</Button>
            </Popconfirm>
          ) : (
            <Tooltip title="全局阈值（系统配置）缺失，无法恢复默认；请手工填写">
              {/* disabled 元素不派发鼠标事件，包一层 span 让 Tooltip 仍能触发 */}
              <span style={{ display: 'inline-block' }}>
                <Button disabled>恢复默认</Button>
              </span>
            </Tooltip>
          )}
          <div style={{ display: 'flex', gap: token.marginXS }}>
            <Button onClick={handleCancel}>取消</Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={() => {
                void handleSubmit();
              }}
            >
              保存
            </Button>
          </div>
        </div>
      }
    >
      {/* Modal.useModal 的上下文占位，必须渲染才能拿到 ConfigProvider 的主题 */}
      {contextHolder}
      <Form form={form} layout="horizontal" requiredMark={false}>
        <Row gutter={token.marginLG}>
          {data?.targets.map((item, index) => (
            <Col span={12} key={item.timeSlotCode}>
              {/* 不用 Form.Item 的 label 承载时段名：一行要放**两个**带 name 的输入框，
                  而 Form.Item 只能绑一个 name；嵌套 + noStyle 又会吞掉字段级错误展示。
                  故 label 用定宽 span、两个输入框各自是独立 Form.Item（错误红字就近显示）。
                  时段名取接口下发的 timeSlotName，禁止硬编码（AGENTS.md §4.4） */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: token.marginXXS }}>
                <span style={labelStyle}>{item.timeSlotName}：</span>
                <Form.Item
                  name={['targets', index, 'valueDown']}
                  style={{ flex: 1, marginBottom: token.marginSM }}
                >
                  <InputNumber {...numberProps} aria-label={`${item.timeSlotName}目标下限`} />
                </Form.Item>
                <span style={separatorStyle} aria-hidden>
                  ~
                </span>
                <Form.Item
                  name={['targets', index, 'valueUp']}
                  style={{ flex: 1, marginBottom: token.marginSM }}
                >
                  <InputNumber {...numberProps} aria-label={`${item.timeSlotName}目标上限`} />
                </Form.Item>
                <span
                  style={{ ...labelStyle, flex: 'none', color: token.colorTextSecondary }}
                  aria-hidden
                >
                  {TARGET_UNIT}
                </span>
              </div>
            </Col>
          ))}
        </Row>

        {/* 预警值另起一行（规格 §6.3）。与时段目标是两套独立机制（裁定 O）：
            这里改的是趋势图阈值线与将来预警判定的边界，不影响 resultType 的 0/1/2 分类 */}
        <Row gutter={token.marginLG}>
          <Col span={12}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: token.marginXXS }}>
              <span style={labelStyle}>低血糖预警：</span>
              <Form.Item
                name={['alert', 'lowThreshold']}
                style={{ flex: 1, marginBottom: token.marginSM }}
              >
                <InputNumber {...numberProps} aria-label="低血糖预警值" />
              </Form.Item>
              {/* 单位用独立 span 而非 InputNumber 的 addonAfter：后者在本仓 antd 版本已弃用
                  （控制台警告 "Please use Space.Compact instead"），且与时段行的单位写法不一致 */}
              <span
                style={{ ...labelStyle, flex: 'none', color: token.colorTextSecondary }}
                aria-hidden
              >
                {TARGET_UNIT}
              </span>
            </div>
          </Col>
          <Col span={12}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: token.marginXXS }}>
              <span style={labelStyle}>高血糖预警：</span>
              <Form.Item
                name={['alert', 'highThreshold']}
                style={{ flex: 1, marginBottom: token.marginSM }}
              >
                <InputNumber {...numberProps} aria-label="高血糖预警值" />
              </Form.Item>
              <span
                style={{ ...labelStyle, flex: 'none', color: token.colorTextSecondary }}
                aria-hidden
              >
                {TARGET_UNIT}
              </span>
            </div>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

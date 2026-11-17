/**
 * 脱敏演示数据。仅用于本地开发，严禁使用真实患者数据。
 * 执行：pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import { DICT_TYPE, TIME_SLOTS } from '@gc/shared';
import {
  encryptDeterministic as cipher,
  isFieldCryptoConfigured,
  maskIdCard,
  maskName,
  maskPhone,
} from '../src/common/crypto/field-crypto';

const prisma = new PrismaClient();

// 加密与脱敏一律走 src/common/crypto/field-crypto（全仓唯一实现）。
// 此处曾自带 `cipher()` / `maskName()` 副本，会绕过 AES 直接写 base64，
// 导致"配了密钥但 seed 出来的数据仍是明文等价"，已于 2026-11-17 收口。
if (!isFieldCryptoConfigured()) {
  console.warn(
    '[seed] ⚠️ 未配置 PATIENT_FIELD_KEY：演示数据的敏感字段将以 base64 存储（不是加密）。' +
      '本地开发可接受；配置密钥后请执行 pnpm db:reencrypt 重加密存量数据。',
  );
}

async function main(): Promise<void> {
  const passwordHash = bcrypt.hashSync('Gc@2026pass', 10);

  // ---------- 角色（与 @gc/shared ROLE_CODE 保持一致） ----------
  const roles = await Promise.all(
    [
      { code: 'DOCTOR', name: '医生' },
      { code: 'NURSE', name: '护士' },
      { code: 'NURSE_HEAD', name: '护士长' },
      { code: 'DEVICE_ADMIN', name: '设备管理员' },
      { code: 'SYS_ADMIN', name: '系统管理员' },
    ].map((role) => prisma.role.upsert({ where: { code: role.code }, update: {}, create: role })),
  );
  const roleByCode = new Map(roles.map((role) => [role.code, role.id]));
  const roleId = (code: string): string => {
    const id = roleByCode.get(code);
    if (!id) {
      throw new Error(`角色未初始化: ${code}`);
    }
    return id;
  };

  // ---------- 科室 ----------
  const endocrinology = await prisma.department.upsert({
    where: { code: 'ENDO' },
    update: {},
    create: { code: 'ENDO', name: '内分泌科' },
  });
  const cardiology = await prisma.department.upsert({
    where: { code: 'CARD' },
    update: {},
    create: { code: 'CARD', name: '心内科' },
  });

  // ---------- 账号 ----------
  async function ensureUser(
    username: string,
    name: string,
    phone: string,
    departmentId: string,
    roleCode: string,
    requireChangePassword = true,
  ) {
    const user = await prisma.user.upsert({
      where: { username },
      // 重跑 seed 即重置演示状态：统一密码；默认未改密，便于反复演示首次强制改密
      update: { passwordHash, mustChangePassword: requireChangePassword },
      create: {
        username,
        name,
        phoneCipher: cipher(phone),
        passwordHash,
        departmentId,
        // 演示"首次登录强制改密"：真实上线时由管理员创建账号或重置密码后置位
        mustChangePassword: requireChangePassword,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roleId(roleCode) } },
      update: {},
      create: { userId: user.id, roleId: roleId(roleCode) },
    });
    return user;
  }

  // dr.wang 作为"已正常登录、无需强制改密"的演示账号（区别于其他需首次改密的账号）
  const doctorWang = await ensureUser('dr.wang', '王医生', '13800000001', endocrinology.id, 'DOCTOR', false);
  const nurseLi = await ensureUser('nurse.li', '李护士', '13800000002', endocrinology.id, 'NURSE');
  const headNurse = await ensureUser('head.zhou', '周护士长', '13800000003', endocrinology.id, 'NURSE_HEAD');
  // 其他科室账号：用于验证跨科室越权被拒
  const doctorChen = await ensureUser('dr.chen', '陈医生', '13800000004', cardiology.id, 'DOCTOR');
  // 最高权限演示账号：SYS_ADMIN，可查看/使用全部功能（系统管理、人员管理等均可见）
  await ensureUser('sys.admin', '系统管理员', '13800000009', endocrinology.id, 'SYS_ADMIN', false);

  // ---------- 患者（假数据） ----------
  const patientSeeds = [
    {
      patientNo: 'P2026000001',
      name: '张三',
      gender: 'MALE',
      birthDate: new Date('1990-01-01'),
      idCard: '110101199001011234',
      phone: '13900001111',
      bedNo: '12-3',
      status: 'INPATIENT' as const,
      admissionAt: dayjs().subtract(3, 'day').toDate(),
      dischargeAt: null,
    },
    {
      patientNo: 'P2026000002',
      name: '李四',
      gender: 'FEMALE',
      birthDate: new Date('1985-05-05'),
      idCard: '110101198505054321',
      phone: '13900002222',
      bedNo: '12-5',
      status: 'INPATIENT' as const,
      admissionAt: dayjs().subtract(5, 'day').toDate(),
      dischargeAt: null,
    },
    {
      patientNo: 'P2026000003',
      name: '王五',
      gender: 'MALE',
      birthDate: new Date('1978-12-12'),
      idCard: '110101197812129876',
      phone: '13900003333',
      bedNo: '15-1',
      status: 'DISCHARGED' as const,
      admissionAt: dayjs().subtract(10, 'day').toDate(),
      dischargeAt: dayjs().subtract(2, 'day').toDate(),
    },
  ];
  const patients: Array<{ id: string }> = [];
  for (const seed of patientSeeds) {
    // 兼容旧 seed 创建的无住院号记录：先补住院号，避免重复插入
    await prisma.patient.updateMany({
      where: { patientNo: null, nameMasked: maskName(seed.name) },
      data: { patientNo: seed.patientNo },
    });
    patients.push(
      await prisma.patient.upsert({
        where: { patientNo: seed.patientNo },
        update: {
          nameCipher: cipher(seed.name),
          nameMasked: maskName(seed.name),
          idCardCipher: cipher(seed.idCard),
          idCardMasked: maskIdCard(seed.idCard),
          phoneCipher: cipher(seed.phone),
          phoneMasked: maskPhone(seed.phone),
          gender: seed.gender,
          birthDate: seed.birthDate,
          bedNo: seed.bedNo,
          departmentId: endocrinology.id,
          status: seed.status,
          admissionAt: seed.admissionAt,
          dischargeAt: seed.dischargeAt,
          doctorId: doctorWang.id,
        },
        create: {
          patientNo: seed.patientNo,
          nameCipher: cipher(seed.name),
          nameMasked: maskName(seed.name),
          idCardCipher: cipher(seed.idCard),
          idCardMasked: maskIdCard(seed.idCard),
          phoneCipher: cipher(seed.phone),
          phoneMasked: maskPhone(seed.phone),
          gender: seed.gender,
          birthDate: seed.birthDate,
          bedNo: seed.bedNo,
          departmentId: endocrinology.id,
          status: seed.status,
          admissionAt: seed.admissionAt,
          dischargeAt: seed.dischargeAt,
          doctorId: doctorWang.id,
        },
      }),
    );
  }

  // ---------- 批量演示患者：3 条基础数据 + 997 条生成数据 = 1000 ----------
  const BULK_INPATIENT_COUNT = 698;
  const BULK_DISCHARGED_COUNT = 299;
  const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林'];
  const givenNames = ['伟', '芳', '娜', '敏', '静', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '桂英'];

  for (let index = 0; index < BULK_INPATIENT_COUNT + BULK_DISCHARGED_COUNT; index += 1) {
    const isInpatient = index < BULK_INPATIENT_COUNT;
    const isEndocrinology = index % 5 !== 0;
    const patientNo = `P2026${String(index + 4).padStart(6, '0')}`;
    const name = `${surnames[index % surnames.length]}${givenNames[index % givenNames.length]}`;
    const admissionAt = isInpatient
      ? dayjs().subtract((index % 30) + 1, 'day').hour(8).minute(0).second(0)
      : dayjs().subtract((index % 40) + 20, 'day').hour(8).minute(0).second(0);
    const dischargeAt = isInpatient
      ? null
      : dayjs().subtract((index % 15) + 1, 'day').hour(10).minute(0).second(0);
    const data = {
      nameCipher: cipher(name),
      nameMasked: maskName(name),
      gender: index % 2 === 0 ? 'MALE' : 'FEMALE',
      birthDate: dayjs().subtract(20 + (index % 70), 'year').toDate(),
      bedNo: `${isEndocrinology ? '12' : '15'}-${String((index % 60) + 1).padStart(2, '0')}`,
      departmentId: isEndocrinology ? endocrinology.id : cardiology.id,
      status: isInpatient ? ('INPATIENT' as const) : ('DISCHARGED' as const),
      admissionAt: admissionAt.toDate(),
      dischargeAt: dischargeAt?.toDate() ?? null,
      doctorId: isEndocrinology ? doctorWang.id : doctorChen.id,
    };
    patients.push(
      await prisma.patient.upsert({
        where: { patientNo },
        update: data,
        create: { patientNo, ...data },
      }),
    );
  }

  // ---------- 最近血糖：每位患者 3~5 条，列表取 measuredAt 最新一条 ----------
  const mealContexts = ['FASTING', 'BREAKFAST_POST', 'LUNCH_PRE', 'LUNCH_POST', 'DINNER_POST', 'BEDTIME'];
  const patientIds = patients.map((patient) => patient.id);
  await prisma.glucoseRecord.deleteMany({ where: { patientId: { in: patientIds } } });
  const glucoseRows: Array<{
    patientId: string;
    resultType: string;
    valueMmolL: number;
    mealContext: string;
    measuredAt: Date;
    operatorId: string;
    testStrip: number | null;
    remark: string | null;
  }> = [];
  patients.forEach((patient, patientIndex) => {
    const recordCount = 3 + (patientIndex % 3);
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      const valueMmolL = Number((4.2 + ((patientIndex * 7 + recordIndex * 11) % 90) / 10).toFixed(1));
      glucoseRows.push({
        patientId: patient.id,
        // 0 偏低 / 1 正常 / 2 偏高：与 UI-DESIGN-TOKENS 5.1 阈值一致
        resultType: valueMmolL < 3.9 ? '0' : valueMmolL <= 16.7 ? '1' : '2',
        valueMmolL,
        mealContext: mealContexts[(patientIndex + recordIndex) % mealContexts.length],
        measuredAt: dayjs()
          .subtract(recordIndex * 6 + (patientIndex % 12), 'hour')
          .toDate(),
        operatorId: recordIndex % 2 === 0 ? nurseLi.id : headNurse.id,
        testStrip: ((patientIndex + recordIndex) % 50) + 1,
        remark: recordIndex === 0 ? '餐前指尖血，患者配合良好' : null,
      });
    }
  });
  await prisma.glucoseRecord.createMany({ data: glucoseRows });

  // ---------- 设备与绑定 ----------
  const deviceSeeds = [
    { sn: 'BG20260001', model: '试纸型血糖仪 A1', manufacturer: '示例厂商甲', bindTo: 0 },
    { sn: 'BG20260002', model: '试纸型血糖仪 A1', manufacturer: '示例厂商甲', bindTo: 1 },
    { sn: 'BG20260003', model: '免校准血糖仪 B2', manufacturer: '示例厂商乙', bindTo: null },
  ];
  for (const seed of deviceSeeds) {
    const device = await prisma.device.upsert({
      where: { sn: seed.sn },
      update: {},
      create: {
        sn: seed.sn,
        model: seed.model,
        manufacturer: seed.manufacturer,
        firmwareVersion: '1.0.0',
        calibratedAt: dayjs().subtract(10, 'day').toDate(),
        departmentId: endocrinology.id,
      },
    });
    if (seed.bindTo === null) {
      continue;
    }
    const bound = await prisma.patientDeviceBinding.findFirst({
      where: { deviceId: device.id, unboundAt: null },
    });
    if (bound) {
      continue;
    }
    await prisma.patientDeviceBinding.create({
      data: { patientId: patients[seed.bindTo].id, deviceId: device.id, operatorId: headNurse.id },
    });
    await prisma.device.update({ where: { id: device.id }, data: { status: 'BOUND' } });
  }

  // ---------- 系统配置 ----------
  const configs = [
    { key: 'device.offline_hours', value: '24', description: '设备离线判定时长（小时）' },
  ];
  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }

  // ---------- 动态字典（公共数据 DY-RESULT：血糖监测结果） ----------
  // 0/1/2（偏低/正常/偏高）由后台按阈值自动判定，checkable=false 不进录入选项
  // （录入界面用「检测」占位，选了就填数值）；
  // 5~9（拒检/外出/请假/已吃饭/未进食）不计入统计，counted=false。
  const glucoseResults = [
    { code: '0', label: '偏低', color: '#4BB2ED', checkable: false, counted: true },
    { code: '1', label: '正常', color: '#389E0D', checkable: false, counted: true },
    { code: '2', label: '偏高', color: '#FF1516', checkable: false, counted: true },
    { code: '3', label: 'Low', color: '#4BB2ED', checkable: true, counted: true },
    { code: '4', label: 'High', color: '#FF1516', checkable: true, counted: true },
    { code: '5', label: '拒检', color: '#3C3C3C', checkable: true, counted: false },
    { code: '6', label: '外出', color: '#3C3C3C', checkable: true, counted: false },
    { code: '7', label: '请假', color: '#3C3C3C', checkable: true, counted: false },
    { code: '8', label: '已吃饭', color: '#3C3C3C', checkable: true, counted: false },
    { code: '9', label: '未进食', color: '#3C3C3C', checkable: true, counted: false },
  ];
  for (const [index, item] of glucoseResults.entries()) {
    const dictType = DICT_TYPE.GLUCOSE_RESULT;
    const data = { ...item, sortOrder: index, enabled: true };
    await prisma.dictItem.upsert({
      where: { dictType_code: { dictType, code: item.code } },
      update: data,
      create: { dictType, ...data },
    });
  }

  // ---------- 时段（DY-TIMESLOT，原静态字典改为动态数据） ----------
  // 初始值以 @gc/shared TIME_SLOTS 为唯一来源，避免库里与代码两份数据漂移；
  // 上线后由临床在库里直接调整（改名/改区间/改控糖目标），不再改代码。
  // 普通时段 00:00~24:00 首尾相接、左闭右开；特殊（随机/复测）与强化无区间。
  for (const slot of TIME_SLOTS) {
    const data = { ...slot, enabled: true };
    await prisma.timeSlot.upsert({
      where: { code: slot.code },
      update: data,
      create: data,
    });
  }

  console.warn('[seed] 完成。演示账号：dr.wang / nurse.li / head.zhou / dr.chen，密码均为 Gc@2026pass');
}

main()
  .catch((error) => {
    console.error('[seed] 失败', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
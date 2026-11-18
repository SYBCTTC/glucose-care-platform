import { useState } from 'react';
import { Empty } from 'antd';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import { layoutSize } from '@/styles/tokens';

/** 主 Tab（下划线高亮）。注意：此处"基本信息"是待实现的 Tab，与顶部基本信息区是两回事（决策 D4） */
const MAIN_TABS: TabItem[] = [
  { key: 'glucose', label: '血糖数据' },
  { key: 'basic', label: '基本信息' },
  { key: 'admission', label: '出入院记录' },
];

/** "血糖数据"下的子 Tab（背景色高亮） */
const GLUCOSE_SUB_TABS: TabItem[] = [
  { key: 'report', label: '血糖报告' },
  { key: 'record', label: '血糖记录' },
  { key: 'trend', label: '趋势图' },
];

const GLUCOSE_SUB_LABELS: Record<string, string> = {
  report: '血糖报告',
  record: '血糖记录',
  trend: '趋势图',
};

const MAIN_PLACEHOLDER: Record<string, string> = {
  basic: '基本信息',
  admission: '出入院记录',
};

/**
 * 详情页 Tabs 区（占满剩余空间）。
 * 本期全部为占位（决策 A4/E1）：血糖报告/记录/趋势图 + 基本信息 Tab + 出入院记录 Tab 均不实现、不发请求。
 * 默认进入：血糖数据 → 血糖报告。
 */
export default function PatientDetailTabs() {
  const [mainTab, setMainTab] = useState('glucose');
  const [glucoseTab, setGlucoseTab] = useState('report');

  const placeholderStyle = {
    padding: `${layoutSize.cardPadding * 2}px 0`,
    textAlign: 'center' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Tabs items={MAIN_TABS} value={mainTab} onChange={setMainTab} variant="underline" />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          marginTop: layoutSize.cardGap,
        }}
      >
        {mainTab === 'glucose' ? (
          <>
            <Tabs
              items={GLUCOSE_SUB_TABS}
              value={glucoseTab}
              onChange={setGlucoseTab}
              variant="background"
            />
            <div style={placeholderStyle}>
              <Empty description={`${GLUCOSE_SUB_LABELS[glucoseTab]}（建设中）`} />
            </div>
          </>
        ) : (
          <div style={placeholderStyle}>
            <Empty description={`${MAIN_PLACEHOLDER[mainTab]}（建设中）`} />
          </div>
        )}
      </div>
    </div>
  );
}

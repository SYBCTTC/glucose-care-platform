import { useState } from 'react';
import { Alert, Button, Card, Result, message } from 'antd';
import type { VirtualWardListItem } from '@gc/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { joinWard, leaveWard } from '@/api/ward';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import { DETAIL_DEFAULT_TAB, DETAIL_PATH_PREFIX } from '../patient-detail/detail-tabs';
import PatientCardGrid from '../patients/PatientCardGrid';
import PatientTable from '../patients/PatientTable';
import { useVirtualWardQuery, type WardViewMode } from './useVirtualWardQuery';
import VirtualWardFilter from './VirtualWardFilter';
import VirtualWardToolbar from './VirtualWardToolbar';
import WardMoreActions from './WardMoreActions';

/**
 * 虚拟病区页。
 *
 * 患者展示直接复用患者管理的 PatientTable / PatientCardGrid（决策 4：展示一致），
 * 只通过 wardTab + wardOf + renderActions 三个 props 切换差异部分：
 * 血糖三项换成「加入虚拟病区天数」，操作列换成单菜单 WardMoreActions。
 *
 * 当前 Tab 有卡片/列表两种模式，历史 Tab 只有列表（决策 4）。
 */

const VIEW_TABS: TabItem[] = [
  { key: 'CARD', label: '卡片' },
  { key: 'LIST', label: '列表' },
];

/** 基本信息 8 列合计 820px，加上天数列与操作列 */
const SCROLL_X_CURRENT = 1100;
/** 历史 Tab 另有加入时间、移出时间两列（各 170px） */
const SCROLL_X_HISTORY = 1450;

/** 从行里取本次进出时间，天数由 formatWardDays 在前端算 */
function wardOf(record: VirtualWardListItem) {
  return { joinedAt: record.wardJoinedAt, leftAt: record.wardLeftAt };
}

export default function VirtualWardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useVirtualWardQuery();
  /** 正在提交的患者 ID，用于禁用菜单防连点 */
  const [pendingId, setPendingId] = useState<string | null>(null);

  // C1 方式B：进详情时带上来源路径，详情页返回据此 navigate(-1) 还原本页 Tab/筛选/视图/页码。
  //
  // **直接跳默认子页**而不是裸详情 URL：裸 URL 会命中详情页 index 路由的 <Navigate replace>，
  // 而 replace 覆盖 history 条目时一旦漏传 state，from 就没了 → 返回会退化成兜底跳**患者管理**，
  // 从虚拟病区进来的用户被送错页，本页快照也一并失效。直达可让正常入口完全不经过 replace。
  const goDetail = (patient: VirtualWardListItem) => {
    navigate(`${DETAIL_PATH_PREFIX}${patient.id}/${DETAIL_DEFAULT_TAB}`, {
      state: { from: location.pathname },
    });
  };

  const handleAction = async (patient: VirtualWardListItem) => {
    setPendingId(patient.id);
    try {
      if (query.isCurrent) {
        await leaveWard(patient.id);
        void message.success('已移出虚拟病区');
      } else {
        // 历史 Tab 的「加入虚拟病区」= 重新加入，后端新建记录、旧历史行保留
        await joinWard(patient.id);
        void message.success('已加入虚拟病区');
      }
      // 该行已不属于当前 Tab（移除后进历史、加入后回当前），局部移除而不整表重查
      query.removeItem(patient.id);
    } catch {
      // 失败提示由请求拦截器统一处理（含 44001/44002 并发冲突、越权 30002）
    } finally {
      setPendingId(null);
    }
  };

  if (!query.canView) {
    return (
      <Card>
        <Result status="403" title="无虚拟病区查看权限" subTitle="请联系管理员分配虚拟病区查看权限" />
      </Card>
    );
  }

  const renderActions = (record: VirtualWardListItem) => (
    <WardMoreActions
      patient={record}
      tab={query.tab}
      canManage={query.canManage}
      pendingId={pendingId}
      onConfirm={handleAction}
    />
  );

  return (
    <Card
      style={
        query.isCardMode
          ? { height: 'calc(100vh - 88px)', minHeight: 480, overflow: 'hidden' }
          : undefined
      }
      styles={
        query.isCardMode
          ? {
              body: {
                height: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              },
            }
          : undefined
      }
    >
      <VirtualWardToolbar value={query.tab} onChange={query.changeTab} />
      <VirtualWardFilter
        tab={query.tab}
        filters={query.filters}
        departments={query.departmentOptions}
        doctors={query.doctorOptions}
        onDepartmentChange={query.setDepartment}
        onDoctorChange={query.setDoctor}
        onPatch={query.patch}
        onSearch={query.search}
        onReset={query.reset}
        loading={query.filterLoading}
      />

      {/* 历史 Tab 只有列表模式，不渲染视图切换（决策 4） */}
      {query.isCurrent ? (
        <div style={{ marginTop: 16 }}>
          <Tabs
            items={VIEW_TABS}
            value={query.viewMode}
            onChange={(key) => query.changeViewMode(key as WardViewMode)}
            variant="background"
          />
        </div>
      ) : null}

      <div
        style={{
          marginTop: query.isCurrent ? 0 : 16,
          ...(query.isCardMode
            ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
            : {}),
        }}
      >
        {query.activeError ? (
          <Alert
            type="error"
            showIcon
            message={query.activeError}
            style={{ marginBottom: 12, flexShrink: 0 }}
            action={
              query.isCardMode ? (
                <Button size="small" onClick={query.retryCards}>
                  重试
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {query.isCardMode ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <PatientCardGrid
              items={query.cardItems}
              loading={query.cardLoading}
              hasMore={query.cardHasMore}
              hasError={Boolean(query.cardError)}
              onLoadMore={query.loadMore}
              onViewDetail={goDetail}
              emptyText="暂无虚拟病区患者"
              wardOf={wardOf}
              renderActions={renderActions}
            />
          </div>
        ) : (
          <PatientTable
            items={query.result?.items ?? []}
            total={query.result?.total ?? 0}
            loading={query.loading}
            page={query.page}
            pageSize={query.pageSize}
            onPageChange={query.changePage}
            onViewDetail={goDetail}
            scrollX={query.isCurrent ? SCROLL_X_CURRENT : SCROLL_X_HISTORY}
            emptyText="暂无虚拟病区患者"
            wardTab={query.tab}
            wardOf={wardOf}
            renderActions={renderActions}
          />
        )}
      </div>
    </Card>
  );
}

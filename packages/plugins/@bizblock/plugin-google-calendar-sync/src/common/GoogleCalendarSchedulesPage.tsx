/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useMemo, useState } from 'react';
import { MoreOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Dropdown,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useRequest } from 'ahooks';
import dayjs, { Dayjs } from 'dayjs';

type ApiClient = {
  request: (options: { url: string; method?: string; data?: any }) => Promise<any>;
};

type UserRow = {
  id: number | string;
  displayName: string;
  nickname?: string;
  username?: string;
  email?: string;
  connected?: boolean;
  googleAccountEmail?: string;
};

type ScheduleRow = {
  id: number | string;
  userId: number | string;
  user?: UserRow;
  googleAccountEmail?: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  timeZone?: string;
  location?: string;
  isAllDay?: boolean;
  googleCalendarId?: string;
  googleEventId?: string;
  googleHtmlLink?: string;
  syncStatus?: string;
  syncSource?: string;
  lastSyncedAt?: string;
  lastError?: string;
};

type ScheduleForm = {
  userId: string;
  title: string;
  description?: string;
  startAt: Dayjs;
  endAt: Dayjs;
  timeZone?: string;
  location?: string;
};

type ScheduleFilters = {
  userId: string;
  dateRange?: [Dayjs, Dayjs];
};

type ScheduleFilterState = {
  userId: string;
  startAt: Dayjs;
  endAt: Dayjs;
};

const { RangePicker } = DatePicker;

function unwrap(response: any) {
  return response?.data?.data || response?.data || {};
}

function formatDateTime(value?: string) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ja-JP', { hour12: false });
}

function toDayjs(value?: string) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function userLabel(user: UserRow) {
  const account = user.googleAccountEmail || user.email || user.username || '';
  return account ? `${user.displayName} / ${account}` : user.displayName;
}

function serializeFilters(filters: ScheduleFilterState) {
  return {
    userId: filters.userId || 'all',
    startAt: filters.startAt.startOf('day').toISOString(),
    endAt: filters.endAt.endOf('day').toISOString(),
  };
}

function serializeScheduleValues(values: ScheduleForm) {
  return {
    userId: values.userId,
    title: values.title,
    description: values.description || '',
    startAt: values.startAt.toISOString(),
    endAt: values.endAt.toISOString(),
    timeZone: values.timeZone || 'Asia/Tokyo',
    location: values.location || '',
    isAllDay: false,
  };
}

function isSameUserId(a?: number | string, b?: number | string) {
  return String(a || '') === String(b || '');
}

export function GoogleCalendarSchedulesPage({ api }: { api: ApiClient }) {
  const [scheduleForm] = Form.useForm<ScheduleForm>();
  const [filterForm] = Form.useForm<ScheduleFilters>();
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [scheduleFilters, setScheduleFilters] = useState<ScheduleFilterState>(() => ({
    userId: 'all',
    startAt: dayjs().startOf('month'),
    endAt: dayjs().endOf('month'),
  }));

  const statusRequest = useRequest(() =>
    api.request({
      url: 'googleCalendarSync:status',
      method: 'get',
    }),
  );

  const usersRequest = useRequest(() =>
    api.request({
      url: 'googleCalendarSync:listUsers',
      method: 'get',
    }),
  );

  const schedulesRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarSync:listSchedules',
        method: 'post',
        data: serializeFilters(scheduleFilters),
      }),
    {
      refreshDeps: [scheduleFilters],
    },
  );

  const status = unwrap(statusRequest.data);
  const users: UserRow[] = unwrap(usersRequest.data).users || [];
  const currentUserId = status.currentUserId;
  const isAdmin = Boolean(status.isAdmin);
  const manageableUsers = isAdmin ? users : users.filter((user) => isSameUserId(user.id, currentUserId));
  const connectedUsers = manageableUsers.filter((user) => user.connected);
  const schedules: ScheduleRow[] = unwrap(schedulesRequest.data).schedules || [];
  const googleConnectionStatus = statusRequest.loading
    ? { color: 'processing', text: 'Google連携確認中' }
    : !status.configured
      ? { color: 'warning', text: 'OAuth未設定' }
      : status.connected
        ? { color: 'success', text: 'Google連携済み' }
        : { color: 'default', text: 'Google未連携' };
  const googleConnectionAccount = status.googleAccountEmail || status.selectedCalendarId || '';

  const authorizeRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarSync:authorize',
        method: 'post',
      }),
    {
      manual: true,
      onSuccess(response) {
        const authorizeUrl = unwrap(response).authorizeUrl;
        if (!authorizeUrl) {
          message.error('Google 認証 URL を取得できませんでした');
          return;
        }
        window.location.href = authorizeUrl;
      },
      onError(error) {
        message.error(error?.message || 'Google 認証を開始できませんでした');
      },
    },
  );

  const listCalendarsRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarSync:listCalendars',
        method: 'post',
      }),
    {
      manual: true,
      onSuccess() {
        message.success('カレンダー情報を更新しました');
        statusRequest.refresh();
        usersRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || 'カレンダー情報の更新に失敗しました');
      },
    },
  );

  const disconnectRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarSync:disconnect',
        method: 'post',
      }),
    {
      manual: true,
      onSuccess() {
        message.success('Google連携を解除しました');
        statusRequest.refresh();
        usersRequest.refresh();
        schedulesRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || 'Google連携の解除に失敗しました');
      },
    },
  );

  const saveScheduleRequest = useRequest(
    (values: ScheduleForm) => {
      const payload = serializeScheduleValues(values);
      return api.request({
        url: editingSchedule ? 'googleCalendarSync:updateSchedule' : 'googleCalendarSync:createSchedule',
        method: 'post',
        data: editingSchedule ? { id: editingSchedule.id, values: payload } : payload,
      });
    },
    {
      manual: true,
      onSuccess() {
        message.success(editingSchedule ? '予定を更新しました' : '予定を登録しました');
        setScheduleModalOpen(false);
        setEditingSchedule(null);
        scheduleForm.resetFields();
        schedulesRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || '予定の保存に失敗しました');
      },
    },
  );

  const deleteScheduleRequest = useRequest(
    (id: number | string) =>
      api.request({
        url: 'googleCalendarSync:deleteSchedule',
        method: 'post',
        data: { id },
      }),
    {
      manual: true,
      onSuccess() {
        message.success('予定を削除しました');
        schedulesRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || '予定の削除に失敗しました');
      },
    },
  );

  const syncFromGoogleRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarSync:syncFromGoogle',
        method: 'post',
        data: serializeFilters(scheduleFilters),
      }),
    {
      manual: true,
      onSuccess(response) {
        const data = unwrap(response);
        message.success(
          `Google Calendarから同期しました: 取得 ${data.fetched || 0} / 追加 ${data.created || 0} / 更新 ${
            data.updated || 0
          } / 削除 ${data.deleted || 0}`,
        );
        if (data.errors?.length) {
          message.warning(`${data.errors.length}ユーザーで同期エラーがあります`);
        }
        statusRequest.refresh();
        usersRequest.refresh();
        schedulesRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || 'Google Calendarからの同期に失敗しました');
      },
    },
  );

  const userOptions = useMemo(
    () => [
      { label: '全ユーザー', value: 'all' },
      ...users.map((user) => ({
        label: userLabel(user),
        value: String(user.id),
      })),
    ],
    [users],
  );

  const scheduleUserOptions = useMemo(
    () =>
      users.map((user) => ({
        label: user.connected ? userLabel(user) : `${userLabel(user)} / 未連携`,
        value: String(user.id),
        disabled: !user.connected || (!isAdmin && !isSameUserId(user.id, currentUserId)),
      })),
    [currentUserId, isAdmin, users],
  );

  const openCreateSchedule = () => {
    const defaultUser = connectedUsers.find((user) => isSameUserId(user.id, currentUserId)) || connectedUsers[0];
    const startAt = dayjs().add(1, 'hour').startOf('hour');
    setEditingSchedule(null);
    scheduleForm.setFieldsValue({
      userId: defaultUser ? String(defaultUser.id) : undefined,
      title: '',
      description: '',
      startAt,
      endAt: startAt.add(30, 'minute'),
      timeZone: 'Asia/Tokyo',
      location: '',
    });
    setScheduleModalOpen(true);
  };

  const openEditSchedule = (schedule: ScheduleRow) => {
    setEditingSchedule(schedule);
    scheduleForm.setFieldsValue({
      userId: String(schedule.userId),
      title: schedule.title,
      description: schedule.description || '',
      startAt: toDayjs(schedule.startAt) || dayjs(),
      endAt: toDayjs(schedule.endAt) || dayjs().add(30, 'minute'),
      timeZone: schedule.timeZone || 'Asia/Tokyo',
      location: schedule.location || '',
    });
    setScheduleModalOpen(true);
  };

  const scheduleColumns = useMemo(
    () => [
      {
        title: 'ユーザー',
        key: 'user',
        width: 180,
        render: (_: any, record: ScheduleRow) => record.user?.displayName || `User #${record.userId}`,
      },
      {
        title: '予定タイトル',
        dataIndex: 'title',
        key: 'title',
      },
      {
        title: '開始',
        dataIndex: 'startAt',
        key: 'startAt',
        width: 170,
        render: formatDateTime,
      },
      {
        title: '終了',
        dataIndex: 'endAt',
        key: 'endAt',
        width: 170,
        render: formatDateTime,
      },
      {
        title: '同期状態',
        dataIndex: 'syncStatus',
        key: 'syncStatus',
        width: 110,
        render: (value: string) => {
          const color = value === 'synced' ? 'success' : value === 'error' ? 'error' : 'processing';
          return <Tag color={color}>{value || 'pending'}</Tag>;
        },
      },
      {
        title: '起点',
        dataIndex: 'syncSource',
        key: 'syncSource',
        width: 90,
        render: (value: string) => value || '-',
      },
      {
        title: 'Google',
        dataIndex: 'googleHtmlLink',
        key: 'googleHtmlLink',
        width: 90,
        render: (value: string) =>
          value ? (
            <Typography.Link href={value} target="_blank" rel="noreferrer">
              開く
            </Typography.Link>
          ) : (
            '-'
          ),
      },
      {
        title: 'エラー',
        dataIndex: 'lastError',
        key: 'lastError',
        ellipsis: true,
        render: (value: string) => value || '-',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        width: 150,
        render: (_: any, record: ScheduleRow) =>
          isAdmin || isSameUserId(record.userId, currentUserId) ? (
            <Space size={8}>
              <Button size="small" onClick={() => openEditSchedule(record)}>
                編集
              </Button>
              <Popconfirm title="削除しますか？" onConfirm={() => deleteScheduleRequest.run(record.id)}>
                <Button size="small" danger loading={deleteScheduleRequest.loading}>
                  削除
                </Button>
              </Popconfirm>
            </Space>
          ) : (
            '-'
          ),
      },
    ],
    [currentUserId, deleteScheduleRequest.loading, isAdmin],
  );

  const handleScheduleSearch = (values: ScheduleFilters) => {
    const range = values.dateRange || [dayjs().startOf('month'), dayjs().endOf('month')];
    setScheduleFilters({
      userId: values.userId || 'all',
      startAt: range[0],
      endAt: range[1],
    });
  };

  const handleSaveSchedule = async () => {
    const values = await scheduleForm.validateFields();
    saveScheduleRequest.run(values);
  };

  const scheduleActionMenuItems = [
    {
      key: 'authorize',
      label: status.connected ? 'Google認証をやり直す' : 'Google認証を開始',
      disabled: !status.configured || authorizeRequest.loading,
    },
    {
      key: 'refreshCalendars',
      label: 'カレンダー情報を更新',
      disabled: !status.connected || listCalendarsRequest.loading,
    },
    {
      key: 'syncFromGoogle',
      label: 'Google Calendarから同期',
      disabled: !connectedUsers.length || syncFromGoogleRequest.loading,
    },
    {
      key: 'refreshSchedules',
      label: '一覧を更新',
      disabled: schedulesRequest.loading,
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'disconnect',
      label: '連携解除',
      danger: true,
      disabled: !status.connected || disconnectRequest.loading,
    },
  ];

  const handleGoogleConnectionMenuClick = ({ key }: { key: string }) => {
    if (key === 'authorize') {
      authorizeRequest.run();
      return;
    }

    if (key === 'refreshCalendars') {
      listCalendarsRequest.run();
      return;
    }

    if (key === 'syncFromGoogle') {
      syncFromGoogleRequest.run();
      return;
    }

    if (key === 'refreshSchedules') {
      schedulesRequest.refresh();
      return;
    }

    if (key === 'disconnect') {
      Modal.confirm({
        title: 'Google連携を解除しますか？',
        content: googleConnectionAccount || undefined,
        okText: '解除',
        okButtonProps: { danger: true },
        cancelText: 'キャンセル',
        onOk: () => disconnectRequest.run(),
      });
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {!statusRequest.loading && !status.configured ? (
        <Alert type="warning" showIcon message="Google OAuth設定が未設定です。管理者に設定を依頼してください。" />
      ) : null}
      {!statusRequest.loading && status.configured && !connectedUsers.length ? (
        <Alert
          type="warning"
          showIcon
          message="Google連携済みユーザーがありません"
          description="予定を登録・同期するには、自分のGoogle連携を完了してください。"
        />
      ) : null}

      <Card
        title="スケジュール管理"
        extra={
          <Space wrap>
            <Space size={8}>
              <Tag color={googleConnectionStatus.color}>{googleConnectionStatus.text}</Tag>
              {googleConnectionAccount ? (
                <Typography.Text type="secondary" ellipsis style={{ maxWidth: 220 }}>
                  {googleConnectionAccount}
                </Typography.Text>
              ) : null}
              <Dropdown
                menu={{
                  items: scheduleActionMenuItems,
                  onClick: handleGoogleConnectionMenuClick,
                }}
                placement="bottomRight"
                trigger={['click']}
              >
                <Button
                  aria-label="Google連携メニュー"
                  icon={<MoreOutlined />}
                  loading={
                    authorizeRequest.loading ||
                    listCalendarsRequest.loading ||
                    syncFromGoogleRequest.loading ||
                    schedulesRequest.loading ||
                    disconnectRequest.loading
                  }
                />
              </Dropdown>
            </Space>
            <Button type="primary" onClick={openCreateSchedule} disabled={!connectedUsers.length}>
              新規予定
            </Button>
          </Space>
        }
      >
        <Form
          form={filterForm}
          layout="inline"
          initialValues={{
            userId: scheduleFilters.userId,
            dateRange: [scheduleFilters.startAt, scheduleFilters.endAt],
          }}
          onFinish={handleScheduleSearch}
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="userId" label="ユーザー">
            <Select
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 260 }}
              options={userOptions}
              loading={usersRequest.loading}
            />
          </Form.Item>
          <Form.Item name="dateRange" label="日付範囲">
            <RangePicker />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit">検索</Button>
          </Form.Item>
        </Form>

        <Table
          rowKey="id"
          size="small"
          columns={scheduleColumns}
          dataSource={schedules}
          pagination={{ pageSize: 20 }}
          loading={schedulesRequest.loading}
          scroll={{ x: 1250 }}
        />
      </Card>

      <Modal
        open={scheduleModalOpen}
        title={editingSchedule ? '予定を編集' : '予定を登録'}
        onCancel={() => {
          setScheduleModalOpen(false);
          setEditingSchedule(null);
        }}
        onOk={handleSaveSchedule}
        confirmLoading={saveScheduleRequest.loading}
        destroyOnClose
      >
        <Form form={scheduleForm} layout="vertical">
          <Form.Item label="ユーザー" name="userId" rules={[{ required: true, message: 'ユーザーを選択してください' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={scheduleUserOptions}
              disabled={Boolean(editingSchedule)}
            />
          </Form.Item>
          <Form.Item
            label="予定タイトル"
            name="title"
            rules={[{ required: true, message: '予定タイトルを入力してください' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="開始日時"
            name="startAt"
            rules={[{ required: true, message: '開始日時を入力してください' }]}
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="終了日時" name="endAt" rules={[{ required: true, message: '終了日時を入力してください' }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="場所" name="location">
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="タイムゾーン" name="timeZone">
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="詳細" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export default GoogleCalendarSchedulesPage;

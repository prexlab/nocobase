/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
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

  const users: UserRow[] = unwrap(usersRequest.data).users || [];
  const connectedUsers = users.filter((user) => user.connected);
  const schedules: ScheduleRow[] = unwrap(schedulesRequest.data).schedules || [];

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
        disabled: !user.connected,
      })),
    [users],
  );

  const openCreateSchedule = () => {
    const defaultUser = connectedUsers[0];
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
        render: (_: any, record: ScheduleRow) => (
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
        ),
      },
    ],
    [deleteScheduleRequest.loading],
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {!connectedUsers.length ? (
        <Alert
          type="warning"
          showIcon
          message="Google連携済みユーザーがありません"
          description={
            <Typography.Text>
              先に{' '}
              <Typography.Link href="/admin/settings/bizblock-google-calendar">
                Google Calendar Sync設定
              </Typography.Link>{' '}
              でGoogle認証を完了してください。
            </Typography.Text>
          }
        />
      ) : null}

      <Card
        title="スケジュール管理"
        extra={
          <Space wrap>
            <Button type="primary" onClick={openCreateSchedule} disabled={!connectedUsers.length}>
              新規予定
            </Button>
            <Button
              onClick={() => syncFromGoogleRequest.run()}
              loading={syncFromGoogleRequest.loading}
              disabled={!connectedUsers.length}
            >
              Google Calendarから同期
            </Button>
            <Button onClick={() => schedulesRequest.refresh()} loading={schedulesRequest.loading}>
              更新
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

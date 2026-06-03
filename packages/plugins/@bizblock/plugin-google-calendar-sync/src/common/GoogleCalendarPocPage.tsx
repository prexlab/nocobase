/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Space, Table, Typography, message } from 'antd';
import { useRequest } from 'ahooks';

type ApiClient = {
  request: (options: { url: string; method?: string; data?: any }) => Promise<any>;
};

type SettingsForm = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
};

type CalendarRow = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
};

function unwrap(response: any) {
  return response?.data?.data || response?.data || {};
}

export function GoogleCalendarPocPage({ api }: { api: ApiClient }) {
  const [form] = Form.useForm<SettingsForm>();
  const [settingsMeta, setSettingsMeta] = useState<any>({});
  const [authorizing, setAuthorizing] = useState(false);

  const settingsRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarPoc:getSettings',
        method: 'get',
      }),
    {
      onSuccess(response) {
        const data = unwrap(response);
        setSettingsMeta(data);
        form.setFieldsValue({
          clientId: data.clientId || '',
          redirectUri: data.redirectUri || data.defaultRedirectUri || '',
        });
      },
    },
  );

  const statusRequest = useRequest(() =>
    api.request({
      url: 'googleCalendarPoc:status',
      method: 'get',
    }),
  );

  const status = unwrap(statusRequest.data);
  const calendars: CalendarRow[] = status.calendars || [];

  const saveRequest = useRequest(
    (values: SettingsForm) =>
      api.request({
        url: 'googleCalendarPoc:setSettings',
        method: 'post',
        data: values,
      }),
    {
      manual: true,
      onSuccess() {
        message.success('保存しました');
        settingsRequest.refresh();
        statusRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || '保存に失敗しました');
      },
    },
  );

  const listCalendarsRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarPoc:listCalendars',
        method: 'post',
      }),
    {
      manual: true,
      onSuccess() {
        message.success('カレンダー一覧を更新しました');
        statusRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || 'カレンダー一覧の取得に失敗しました');
      },
    },
  );

  const disconnectRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarPoc:disconnect',
        method: 'post',
      }),
    {
      manual: true,
      onSuccess() {
        message.success('連携を解除しました');
        statusRequest.refresh();
      },
    },
  );

  const columns = useMemo(
    () => [
      {
        title: 'カレンダー名',
        dataIndex: 'summary',
        key: 'summary',
        render: (value: string, record: CalendarRow) => (
          <Space>
            <span>{value}</span>
            {record.primary ? <Typography.Text type="success">primary</Typography.Text> : null}
          </Space>
        ),
      },
      {
        title: 'ID',
        dataIndex: 'id',
        key: 'id',
        render: (value: string) => <Typography.Text copyable>{value}</Typography.Text>,
      },
      {
        title: '権限',
        dataIndex: 'accessRole',
        key: 'accessRole',
        width: 140,
      },
      {
        title: 'タイムゾーン',
        dataIndex: 'timeZone',
        key: 'timeZone',
        width: 180,
      },
    ],
    [],
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    saveRequest.run(values);
  };

  const handleAuthorize = async () => {
    const values = await form.validateFields();
    setAuthorizing(true);
    try {
      await api.request({
        url: 'googleCalendarPoc:setSettings',
        method: 'post',
        data: values,
      });
      const response = await api.request({
        url: 'googleCalendarPoc:authorize',
        method: 'post',
      });
      const authorizeUrl = unwrap(response).authorizeUrl;
      if (!authorizeUrl) {
        throw new Error('Google 認証 URL を取得できませんでした');
      }
      window.location.href = authorizeUrl;
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Google 認証を開始できませんでした');
      setAuthorizing(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Google Calendar PoC" loading={settingsRequest.loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 760 }}>
          <Form.Item
            label="OAuth クライアントID"
            name="clientId"
            rules={[{ required: true, message: 'OAuth クライアントIDを入力してください' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="OAuth クライアントシークレット" name="clientSecret">
            <Input.Password
              autoComplete="new-password"
              placeholder={settingsMeta.hasClientSecret ? '保存済み。変更時だけ入力' : ''}
            />
          </Form.Item>
          <Form.Item
            label="リダイレクトURI"
            name="redirectUri"
            rules={[{ required: true, message: 'リダイレクトURIを入力してください' }]}
          >
            <Input />
          </Form.Item>
          <Space wrap>
            <Button type="primary" onClick={handleAuthorize} loading={authorizing}>
              Google 認証を開始
            </Button>
            <Button onClick={handleSave} loading={saveRequest.loading}>
              保存
            </Button>
            <Button
              onClick={() => listCalendarsRequest.run()}
              loading={listCalendarsRequest.loading}
              disabled={!status.connected}
            >
              カレンダー一覧を更新
            </Button>
            <Button danger onClick={() => disconnectRequest.run()} disabled={!status.connected}>
              連携解除
            </Button>
          </Space>
        </Form>
      </Card>

      <Card title="連携状態" loading={statusRequest.loading}>
        {!status.configured ? (
          <Alert type="warning" showIcon message="OAuth クライアントIDとシークレットを保存してください" />
        ) : null}
        <Descriptions column={1} style={{ marginTop: status.configured ? 0 : 16 }}>
          <Descriptions.Item label="状態">{status.connected ? '連携済み' : '未連携'}</Descriptions.Item>
          <Descriptions.Item label="Google アカウント">{status.googleAccountEmail || '-'}</Descriptions.Item>
          <Descriptions.Item label="選択カレンダーID">{status.selectedCalendarId || '-'}</Descriptions.Item>
          <Descriptions.Item label="最終取得日時">{status.lastFetchedAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="Callback URL">
            <Typography.Text copyable>
              {form.getFieldValue('redirectUri') || settingsMeta.defaultRedirectUri}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="取得済みカレンダー">
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={calendars}
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Card>
    </Space>
  );
}

export default GoogleCalendarPocPage;

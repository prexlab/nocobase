/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useState } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, Select, Space, Switch, Typography, message } from 'antd';
import { useRequest } from 'ahooks';

type ApiClient = {
  request: (options: { url: string; method?: string; data?: any }) => Promise<any>;
};

type SettingsForm = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
};

const AUTO_SYNC_INTERVAL_OPTIONS = [1, 5, 10, 15, 30, 60].map((value) => ({
  value,
  label: `${value}分`,
}));

function unwrap(response: any) {
  return response?.data?.data || response?.data || {};
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function formatSyncResult(value: any) {
  const result = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!result) {
    return '-';
  }
  return `対象${result.users || 0}人 / 取得${result.fetched || 0}件 / 作成${result.created || 0}件 / 更新${
    result.updated || 0
  }件 / 削除${result.deleted || 0}件 / エラー${result.errors?.length || 0}件`;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

export function GoogleCalendarSettingsPage({ api }: { api: ApiClient }) {
  const [settingsForm] = Form.useForm<SettingsForm>();
  const [settingsMeta, setSettingsMeta] = useState<any>({});
  const autoSyncEnabled = Form.useWatch('autoSyncEnabled', settingsForm);

  const settingsRequest = useRequest(
    () =>
      api.request({
        url: 'googleCalendarSync:getSettings',
        method: 'get',
      }),
    {
      onSuccess(response) {
        const data = unwrap(response);
        setSettingsMeta(data);
        settingsForm.setFieldsValue({
          clientId: data.clientId || '',
          redirectUri: data.redirectUri || data.defaultRedirectUri || '',
          autoSyncEnabled: Boolean(data.autoSyncEnabled),
          autoSyncIntervalMinutes: data.autoSyncIntervalMinutes || 15,
        });
      },
    },
  );

  const saveSettingsRequest = useRequest(
    (values: SettingsForm) =>
      api.request({
        url: 'googleCalendarSync:setSettings',
        method: 'post',
        data: values,
      }),
    {
      manual: true,
      onSuccess() {
        message.success('保存しました');
        settingsRequest.refresh();
      },
      onError(error) {
        message.error(error?.message || '保存に失敗しました');
      },
    },
  );

  const handleSaveSettings = async () => {
    const values = await settingsForm.validateFields();
    saveSettingsRequest.run(values);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="Google Calendar Sync"
        loading={settingsRequest.loading}
        extra={
          <Typography.Link href="/admin/bizblock-google-calendar-schedules">スケジュール管理を開く</Typography.Link>
        }
      >
        <Form form={settingsForm} layout="vertical" style={{ maxWidth: 760 }}>
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
          <Typography.Title level={5}>自動同期</Typography.Title>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="初回は今月分から、以降は前回同期以降の更新分をバックグラウンドで取り込みます。"
          />
          <Form.Item label="自動同期" name="autoSyncEnabled" valuePropName="checked">
            <Switch checkedChildren="有効" unCheckedChildren="無効" />
          </Form.Item>
          <Form.Item label="同期間隔" name="autoSyncIntervalMinutes">
            <Select options={AUTO_SYNC_INTERVAL_OPTIONS} style={{ width: 160 }} disabled={!autoSyncEnabled} />
          </Form.Item>
          <div style={{ marginTop: 8 }}>
            <Button type="primary" onClick={handleSaveSettings} loading={saveSettingsRequest.loading}>
              保存
            </Button>
          </div>
        </Form>
      </Card>

      <Card title="設定情報">
        <Descriptions column={1}>
          <Descriptions.Item label="OAuth設定">
            {settingsMeta.hasClientSecret && settingsForm.getFieldValue('clientId') ? '設定済み' : '未設定'}
          </Descriptions.Item>
          <Descriptions.Item label="Callback URL">
            <Typography.Text copyable>
              {settingsForm.getFieldValue('redirectUri') || settingsMeta.defaultRedirectUri}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="自動同期">{settingsMeta.autoSyncEnabled ? '有効' : '無効'}</Descriptions.Item>
          <Descriptions.Item label="同期間隔">{settingsMeta.autoSyncIntervalMinutes || 15}分</Descriptions.Item>
          <Descriptions.Item label="実行中">{settingsMeta.autoSyncRunning ? 'はい' : 'いいえ'}</Descriptions.Item>
          <Descriptions.Item label="次回実行予定">{formatDateTime(settingsMeta.autoSyncNextRunAt)}</Descriptions.Item>
          <Descriptions.Item label="最終開始日時">
            {formatDateTime(settingsMeta.autoSyncLastStartedAt)}
          </Descriptions.Item>
          <Descriptions.Item label="最終終了日時">
            {formatDateTime(settingsMeta.autoSyncLastFinishedAt)}
          </Descriptions.Item>
          <Descriptions.Item label="最終結果">{formatSyncResult(settingsMeta.autoSyncLastResult)}</Descriptions.Item>
          <Descriptions.Item label="最終エラー">{settingsMeta.autoSyncLastError || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

export default GoogleCalendarSettingsPage;

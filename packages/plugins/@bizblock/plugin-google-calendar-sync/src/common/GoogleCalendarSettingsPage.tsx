/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import React, { useState } from 'react';
import { Button, Card, Descriptions, Form, Input, Space, Typography, message } from 'antd';
import { useRequest } from 'ahooks';

type ApiClient = {
  request: (options: { url: string; method?: string; data?: any }) => Promise<any>;
};

type SettingsForm = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
};

function unwrap(response: any) {
  return response?.data?.data || response?.data || {};
}

export function GoogleCalendarSettingsPage({ api }: { api: ApiClient }) {
  const [settingsForm] = Form.useForm<SettingsForm>();
  const [settingsMeta, setSettingsMeta] = useState<any>({});

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
          <Space wrap>
            <Button type="primary" onClick={handleSaveSettings} loading={saveSettingsRequest.loading}>
              保存
            </Button>
          </Space>
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
        </Descriptions>
      </Card>
    </Space>
  );
}

export default GoogleCalendarSettingsPage;

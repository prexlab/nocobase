/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/client';
import GoogleCalendarPocPage from './pages/GoogleCalendarPocPage';

export class BizBlockGoogleCalendarSyncClient extends Plugin {
  async load() {
    this.pluginSettingsManager.add('bizblock-google-calendar', {
      title: 'Google Calendar PoC',
      icon: 'CalendarOutlined',
      Component: GoogleCalendarPocPage,
    });
  }
}

export default BizBlockGoogleCalendarSyncClient;

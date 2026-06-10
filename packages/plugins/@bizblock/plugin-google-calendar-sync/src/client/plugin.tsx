/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/client';
import GoogleCalendarSchedulesPage from './pages/GoogleCalendarSchedulesPage';
import GoogleCalendarSettingsPage from './pages/GoogleCalendarSettingsPage';

export class BizBlockGoogleCalendarSyncClient extends Plugin {
  async load() {
    this.pluginSettingsManager.add('bizblock-google-calendar', {
      title: 'Google Calendar Sync',
      icon: 'CalendarOutlined',
      Component: GoogleCalendarSettingsPage,
    });

    this.router.add('bizblock-google-calendar-schedules', {
      path: '/admin/google-calendar/schedules',
      Component: GoogleCalendarSchedulesPage,
    });
  }
}

export default BizBlockGoogleCalendarSyncClient;

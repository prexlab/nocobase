/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Application, Plugin } from '@nocobase/client-v2';

export class BizBlockGoogleCalendarSyncClientV2 extends Plugin<any, Application> {
  async load() {
    this.pluginSettingsManager.addMenuItem({
      key: 'bizblock-google-calendar',
      title: 'Google Calendar PoC',
      icon: 'CalendarOutlined',
    });

    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'bizblock-google-calendar',
      key: 'index',
      title: 'OAuth / Calendars',
      componentLoader: () => import('./pages/GoogleCalendarPocPage'),
      sort: -1,
    });
  }
}

export default BizBlockGoogleCalendarSyncClientV2;

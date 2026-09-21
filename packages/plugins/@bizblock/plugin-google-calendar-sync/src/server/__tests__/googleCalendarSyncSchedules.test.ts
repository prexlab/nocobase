/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import googleCalendarSyncSchedules from '../collections/googleCalendarSyncSchedules';

describe('googleCalendarSyncSchedules collection', () => {
  it('is exposed to collection management with a distinct display name', () => {
    expect(googleCalendarSyncSchedules).toMatchObject({
      name: 'googleCalendarSyncSchedules',
      tableName: 'googleCalendarSyncSchedules',
      title: '{{t("Google Calendar sync schedules", { ns: "@bizblock/plugin-google-calendar-sync" })}}',
      uiManageable: true,
    });
  });
});

/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'googleCalendarSyncSchedules',
  title: '{{t("Google Calendar sync schedules", { ns: "@bizblock/plugin-google-calendar-sync" })}}',
  uiManageable: true,
  tableName: 'googleCalendarSyncSchedules',
  timestamps: true,
  fields: [
    {
      name: 'userId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
    },
    {
      name: 'title',
      type: 'string',
      allowNull: false,
      interface: 'input',
    },
    {
      name: 'description',
      type: 'text',
      interface: 'textarea',
    },
    {
      name: 'startAt',
      type: 'datetime',
      allowNull: false,
      interface: 'datetime',
    },
    {
      name: 'endAt',
      type: 'datetime',
      allowNull: false,
      interface: 'datetime',
    },
    {
      name: 'timeZone',
      type: 'string',
      interface: 'input',
      defaultValue: 'Asia/Tokyo',
    },
    {
      name: 'location',
      type: 'string',
      interface: 'input',
    },
    {
      name: 'isAllDay',
      type: 'boolean',
      interface: 'boolean',
      defaultValue: false,
    },
    {
      name: 'googleCalendarId',
      type: 'string',
      interface: 'input',
    },
    {
      name: 'googleEventId',
      type: 'string',
      interface: 'input',
    },
    {
      name: 'googleEventEtag',
      type: 'string',
      interface: 'input',
    },
    {
      name: 'googleUpdatedAt',
      type: 'datetime',
      interface: 'datetime',
    },
    {
      name: 'googleHtmlLink',
      type: 'text',
      interface: 'textarea',
    },
    {
      name: 'syncStatus',
      type: 'string',
      interface: 'input',
      defaultValue: 'pending',
    },
    {
      name: 'syncSource',
      type: 'string',
      interface: 'input',
      defaultValue: 'bizblock',
    },
    {
      name: 'lastSyncedAt',
      type: 'datetime',
      interface: 'datetime',
    },
    {
      name: 'isDeleted',
      type: 'boolean',
      interface: 'boolean',
      defaultValue: false,
    },
    {
      name: 'deletedAt',
      type: 'datetime',
      interface: 'datetime',
    },
    {
      name: 'lastError',
      type: 'text',
      interface: 'textarea',
    },
  ],
});

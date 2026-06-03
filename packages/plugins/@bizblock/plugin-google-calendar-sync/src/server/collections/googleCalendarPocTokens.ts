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
  name: 'googleCalendarPocTokens',
  timestamps: true,
  fields: [
    {
      name: 'userId',
      type: 'bigInt',
      allowNull: false,
      unique: true,
      interface: 'integer',
    },
    {
      name: 'googleAccountEmail',
      type: 'string',
      interface: 'input',
    },
    {
      name: 'accessToken',
      type: 'text',
      interface: 'textarea',
    },
    {
      name: 'refreshToken',
      type: 'text',
      interface: 'textarea',
    },
    {
      name: 'tokenExpiry',
      type: 'datetime',
      interface: 'datetime',
    },
    {
      name: 'scope',
      type: 'text',
      interface: 'textarea',
    },
    {
      name: 'calendars',
      type: 'json',
      interface: 'json',
      defaultValue: [],
    },
    {
      name: 'selectedCalendarId',
      type: 'string',
      interface: 'input',
    },
    {
      name: 'isActive',
      type: 'boolean',
      interface: 'boolean',
      defaultValue: true,
    },
    {
      name: 'lastFetchedAt',
      type: 'datetime',
      interface: 'datetime',
    },
  ],
});

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
  name: 'googleCalendarPocStates',
  autoGenId: false,
  timestamps: true,
  fields: [
    {
      name: 'state',
      type: 'string',
      primaryKey: true,
      allowNull: false,
      unique: true,
      interface: 'input',
    },
    {
      name: 'userId',
      type: 'bigInt',
      allowNull: false,
      interface: 'integer',
    },
    {
      name: 'expiresAt',
      type: 'datetime',
      allowNull: false,
      interface: 'datetime',
    },
    {
      name: 'consumedAt',
      type: 'datetime',
      interface: 'datetime',
    },
  ],
});

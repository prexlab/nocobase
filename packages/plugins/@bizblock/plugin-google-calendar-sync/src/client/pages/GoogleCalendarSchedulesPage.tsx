/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { useAPIClient } from '@nocobase/client';
import React from 'react';
import GoogleCalendarSchedulesPage from '../../common/GoogleCalendarSchedulesPage';

export default function GoogleCalendarSchedulesClientPage() {
  const api = useAPIClient();
  return <GoogleCalendarSchedulesPage api={api} />;
}

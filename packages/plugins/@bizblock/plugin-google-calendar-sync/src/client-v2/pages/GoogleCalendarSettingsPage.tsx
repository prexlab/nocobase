/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { useFlowContext } from '@nocobase/flow-engine';
import React from 'react';
import GoogleCalendarSettingsPage from '../../common/GoogleCalendarSettingsPage';

export default function GoogleCalendarSettingsClientV2Page() {
  const ctx = useFlowContext();
  return <GoogleCalendarSettingsPage api={ctx.api} />;
}

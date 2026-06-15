/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Plugin } from '@nocobase/server';
import crypto from 'node:crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const GOOGLE_CALENDAR_EVENTS_BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

const RESOURCE_NAME = 'googleCalendarSync';
const SETTINGS_COLLECTION = 'googleCalendarSyncSettings';
const STATES_COLLECTION = 'googleCalendarSyncStates';
const TOKENS_COLLECTION = 'googleCalendarSyncTokens';
const SCHEDULES_COLLECTION = 'googleCalendarSyncSchedules';
const SCHEDULES_PAGE_SCHEMA_UID = 'bizblock-google-calendar-schedules';
const SCHEDULES_PAGE_MENU_SCHEMA_UID = 'bizblock-google-calendar-schedules-menu';
const SCHEDULES_PAGE_TAB_SCHEMA_UID = 'bizblock-google-calendar-schedules-main';
const SCHEDULES_PAGE_TAB_SCHEMA_NAME = 'bizblockGoogleCalendarSchedulesMain';

type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  etag?: string;
  htmlLink?: string;
  status?: string;
  updated?: string;
};

type GoogleCalendarListEvent = GoogleCalendarEvent & {
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
};

export class BizBlockGoogleCalendarSyncServer extends Plugin {
  async load() {
    const actions = {
      getSettings: this.getSettings,
      setSettings: this.setSettings,
      authorize: this.authorize,
      callback: this.callback,
      status: this.status,
      listCalendars: this.listCalendars,
      listUsers: this.listUsers,
      listSchedules: this.listSchedules,
      createSchedule: this.createSchedule,
      updateSchedule: this.updateSchedule,
      deleteSchedule: this.deleteSchedule,
      syncFromGoogle: this.syncFromGoogle,
      disconnect: this.disconnect,
    };
    const loggedInActions = [
      'getSettings',
      'setSettings',
      'authorize',
      'status',
      'listCalendars',
      'listUsers',
      'listSchedules',
      'createSchedule',
      'updateSchedule',
      'deleteSchedule',
      'syncFromGoogle',
      'disconnect',
    ];

    this.app.resourceManager.define({
      name: RESOURCE_NAME,
      actions,
    });
    this.app.acl.allow(RESOURCE_NAME, loggedInActions, 'loggedIn');
    this.app.acl.allow(RESOURCE_NAME, 'callback', 'public');

    this.app.acl.registerSnippet({
      name: `pm.${this.name}.google-calendar-sync`,
      actions: [`${RESOURCE_NAME}:*`],
    });

    await this.ensureSchedulesDesktopRoute();
  }

  private async ensureSchedulesDesktopRoute() {
    if (!this.app.db.hasCollection('desktopRoutes') || !this.app.db.hasCollection('uiSchemas')) {
      return;
    }

    const desktopRoutesRepo = this.app.db.getRepository('desktopRoutes');
    const uiSchemasRepo = this.app.db.getRepository('uiSchemas') as any;
    let pageRoute = await desktopRoutesRepo.findOne({
      filter: {
        schemaUid: SCHEDULES_PAGE_SCHEMA_UID,
      },
    });

    if (!pageRoute) {
      pageRoute = await desktopRoutesRepo.create({
        values: {
          type: 'page',
          title: 'Google Calendar',
          icon: 'CalendarOutlined',
          schemaUid: SCHEDULES_PAGE_SCHEMA_UID,
          menuSchemaUid: SCHEDULES_PAGE_MENU_SCHEMA_UID,
          enableTabs: false,
          enableHeader: true,
          displayTitle: true,
          hideInMenu: false,
          hidden: false,
          children: [
            {
              type: 'tabs',
              title: 'スケジュール管理',
              icon: 'CalendarOutlined',
              schemaUid: SCHEDULES_PAGE_TAB_SCHEMA_UID,
              tabSchemaName: SCHEDULES_PAGE_TAB_SCHEMA_NAME,
              hidden: true,
            },
          ],
        },
      });
    } else {
      await desktopRoutesRepo.update({
        filterByTk: this.getValue(pageRoute, 'id'),
        values: {
          title: 'Google Calendar',
          icon: 'CalendarOutlined',
          type: 'page',
          schemaUid: SCHEDULES_PAGE_SCHEMA_UID,
          menuSchemaUid: SCHEDULES_PAGE_MENU_SCHEMA_UID,
          enableTabs: false,
          enableHeader: true,
          displayTitle: true,
          hideInMenu: false,
          hidden: false,
        },
      });
    }

    const tabRoute = await desktopRoutesRepo.findOne({
      filter: {
        schemaUid: SCHEDULES_PAGE_TAB_SCHEMA_UID,
      },
    });
    const pageRouteId = this.getValue(pageRoute, 'id');

    if (!tabRoute) {
      await desktopRoutesRepo.create({
        values: {
          parentId: pageRouteId,
          type: 'tabs',
          title: 'スケジュール管理',
          icon: 'CalendarOutlined',
          schemaUid: SCHEDULES_PAGE_TAB_SCHEMA_UID,
          tabSchemaName: SCHEDULES_PAGE_TAB_SCHEMA_NAME,
          hidden: true,
        },
      });
    } else {
      await desktopRoutesRepo.update({
        filterByTk: this.getValue(tabRoute, 'id'),
        values: {
          parentId: pageRouteId,
          type: 'tabs',
          title: 'スケジュール管理',
          icon: 'CalendarOutlined',
          schemaUid: SCHEDULES_PAGE_TAB_SCHEMA_UID,
          tabSchemaName: SCHEDULES_PAGE_TAB_SCHEMA_NAME,
          hidden: true,
        },
      });
    }

    await this.ensureSchedulesPageUiSchema(uiSchemasRepo);

    await this.grantSchedulesDesktopRouteToAllRoles(pageRouteId);
  }

  private async ensureSchedulesPageUiSchema(uiSchemasRepo) {
    const pageNode = await uiSchemasRepo.findOne({
      filter: {
        'x-uid': SCHEDULES_PAGE_SCHEMA_UID,
      },
    });

    if (!pageNode) {
      await uiSchemasRepo.insert(this.getSchedulesPageSchema());
      return;
    }
    await uiSchemasRepo.update({
      filter: {
        'x-uid': SCHEDULES_PAGE_SCHEMA_UID,
      },
      values: {
        schema: this.getSchedulesPageNodeSchema(),
      },
    });

    const tabNode = await uiSchemasRepo.findOne({
      filter: {
        'x-uid': SCHEDULES_PAGE_TAB_SCHEMA_UID,
      },
    });

    if (!tabNode) {
      await uiSchemasRepo.insertAdjacent('afterBegin', SCHEDULES_PAGE_SCHEMA_UID, this.getSchedulesPageTabSchema());
      return;
    }
    await uiSchemasRepo.update({
      filter: {
        'x-uid': SCHEDULES_PAGE_TAB_SCHEMA_UID,
      },
      values: {
        schema: this.getSchedulesPageTabNodeSchema(),
      },
    });
  }

  private getSchedulesPageSchema() {
    return {
      ...this.getSchedulesPageNodeSchema(),
      'x-uid': SCHEDULES_PAGE_SCHEMA_UID,
      properties: {
        [SCHEDULES_PAGE_TAB_SCHEMA_NAME]: this.getSchedulesPageTabSchema(),
      },
    };
  }

  private getSchedulesPageNodeSchema() {
    return {
      type: 'void',
      'x-component': 'Page',
      'x-component-props': {
        disablePageHeader: false,
      },
    };
  }

  private getSchedulesPageTabSchema() {
    return {
      ...this.getSchedulesPageTabNodeSchema(),
      'x-uid': SCHEDULES_PAGE_TAB_SCHEMA_UID,
    };
  }

  private getSchedulesPageTabNodeSchema() {
    return {
      type: 'void',
      title: 'スケジュール管理',
      'x-icon': 'CalendarOutlined',
      'x-component': 'BizBlockGoogleCalendarSchedulesPage',
    };
  }

  private async grantSchedulesDesktopRouteToAllRoles(pageRouteId) {
    if (!this.app.db.hasCollection('roles') || !this.app.db.hasCollection('rolesDesktopRoutes')) {
      return;
    }

    const roles = await this.app.db.getRepository('roles').find();
    const rolesDesktopRoutesRepo = this.app.db.getRepository('rolesDesktopRoutes');
    const routeIds = [pageRouteId];
    const tabRoute = await this.app.db.getRepository('desktopRoutes').findOne({
      filter: {
        schemaUid: SCHEDULES_PAGE_TAB_SCHEMA_UID,
      },
    });

    if (tabRoute) {
      routeIds.push(this.getValue(tabRoute, 'id'));
    }

    for (const role of roles) {
      const roleName = this.getValue(role, 'name');
      if (!roleName) {
        continue;
      }
      for (const desktopRouteId of routeIds) {
        await rolesDesktopRoutesRepo.firstOrCreate({
          filterKeys: ['desktopRouteId', 'roleName'],
          values: {
            desktopRouteId,
            roleName,
          },
        });
      }
    }
  }

  getSettings = async (ctx, next) => {
    this.requireAdmin(ctx);
    const settings = await this.readSettings();
    const defaultRedirectUri = this.getDefaultRedirectUri(ctx);
    const redirectUri = settings.redirectUri || defaultRedirectUri;

    ctx.body = {
      clientId: settings.clientId || '',
      redirectUri,
      defaultRedirectUri,
      hasClientSecret: Boolean(settings.clientSecret),
      scopes: GOOGLE_SCOPES,
    };
    await next();
  };

  setSettings = async (ctx, next) => {
    this.requireAdmin(ctx);
    const repo = ctx.db.getRepository(SETTINGS_COLLECTION);
    const existing = await repo.findOne();
    const values = ctx.action?.params?.values || {};
    const current = this.recordToJSON(existing);

    const nextValues: Record<string, string> = {
      clientId: String(values.clientId || '').trim(),
      redirectUri: String(values.redirectUri || '').trim(),
      clientSecret: current?.clientSecret || '',
    };

    if (typeof values.clientSecret === 'string' && values.clientSecret.trim()) {
      nextValues.clientSecret = values.clientSecret.trim();
    }

    if (existing) {
      await repo.update({ filter: { id: this.getValue(existing, 'id') }, values: nextValues });
    } else {
      await repo.create({ values: nextValues });
    }

    ctx.body = { ok: true, hasClientSecret: Boolean(nextValues.clientSecret) };
    await next();
  };

  authorize = async (ctx, next) => {
    const settings = await this.requireSettings(ctx);
    const userId = this.getCurrentUserId(ctx);
    const state = crypto.randomBytes(24).toString('hex');
    const redirectUri = settings.redirectUri || this.getDefaultRedirectUri(ctx);

    await ctx.db.getRepository(STATES_COLLECTION).create({
      values: {
        state,
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);

    ctx.body = {
      authorizeUrl: url.toString(),
      redirectUri,
      scopes: GOOGLE_SCOPES,
    };
    await next();
  };

  callback = async (ctx, next) => {
    ctx.withoutDataWrapping = true;
    ctx.type = 'html';

    try {
      const params = { ...(ctx.query || {}), ...(ctx.request?.query || {}) };
      const code = String(params.code || '');
      const state = String(params.state || '');
      const error = String(params.error || '');

      if (error) {
        ctx.body = this.renderCallbackHtml('Google 認証がキャンセルされました', error);
        await next();
        return;
      }
      if (!code || !state) {
        ctx.throw(400, 'code と state が必要です');
      }

      const stateRepo = ctx.db.getRepository(STATES_COLLECTION);
      const stateRecord = await stateRepo.findOne({ filter: { state } });
      const stateData = this.recordToJSON(stateRecord);

      if (!stateData || stateData.consumedAt) {
        ctx.throw(400, 'OAuth state が無効です');
      }
      if (new Date(stateData.expiresAt).getTime() < Date.now()) {
        ctx.throw(400, 'OAuth state の有効期限が切れています');
      }

      const settings = await this.requireSettings(ctx);
      const redirectUri = settings.redirectUri || this.getDefaultRedirectUri(ctx);
      const token = await this.exchangeAuthorizationCode({
        code,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        redirectUri,
      });
      const googleAccountEmail = await this.fetchGoogleAccountEmail(token.access_token);
      const calendars = await this.fetchCalendarList(token.access_token);

      await this.saveToken(ctx, {
        userId: stateData.userId,
        token,
        googleAccountEmail,
        calendars,
      });
      await stateRepo.update({ filter: { state }, values: { consumedAt: new Date() } });

      ctx.body = this.renderCallbackHtml(
        'Google カレンダー連携が完了しました',
        `${googleAccountEmail || 'Google アカウント'} / ${calendars.length} calendars`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.app.logger?.warn?.(`[googleCalendarSync] OAuth callback failed: ${message}`);
      ctx.body = this.renderCallbackHtml('Google カレンダー連携に失敗しました', message);
    }

    await next();
  };

  status = async (ctx, next) => {
    const userId = this.getCurrentUserId(ctx);
    const settings = await this.readSettings();
    const tokenRecord = await ctx.db.getRepository(TOKENS_COLLECTION).findOne({ filter: { userId } });
    const token = this.recordToJSON(tokenRecord);

    ctx.body = {
      configured: Boolean(settings.clientId && settings.clientSecret),
      hasClientSecret: Boolean(settings.clientSecret),
      connected: Boolean(token?.isActive && token?.accessToken),
      googleAccountEmail: token?.googleAccountEmail || '',
      tokenExpiry: token?.tokenExpiry || null,
      selectedCalendarId: token?.selectedCalendarId || '',
      calendars: token?.calendars || [],
      lastFetchedAt: token?.lastFetchedAt || null,
      scopes: GOOGLE_SCOPES,
      currentUserId: userId,
      isAdmin: this.isAdmin(ctx),
    };
    await next();
  };

  listCalendars = async (ctx, next) => {
    const userId = this.getCurrentUserId(ctx);
    const settings = await this.requireSettings(ctx);
    const tokenRepo = ctx.db.getRepository(TOKENS_COLLECTION);
    const tokenRecord = await tokenRepo.findOne({ filter: { userId } });

    if (!tokenRecord || !this.getValue(tokenRecord, 'refreshToken')) {
      ctx.throw(400, 'Google 認証がまだ完了していません');
    }

    const accessToken = await this.ensureAccessToken(ctx, tokenRecord, settings);
    const calendars = await this.fetchCalendarList(accessToken);
    const selectedCalendarId =
      calendars.find((calendar) => calendar.primary)?.id ||
      this.getValue(tokenRecord, 'selectedCalendarId') ||
      calendars[0]?.id ||
      '';

    await tokenRepo.update({
      filter: { id: this.getValue(tokenRecord, 'id') },
      values: {
        calendars,
        selectedCalendarId,
        lastFetchedAt: new Date(),
        isActive: true,
      },
    });

    ctx.body = { calendars, selectedCalendarId, count: calendars.length };
    await next();
  };

  listSchedules = async (ctx, next) => {
    const values = this.getActionValues(ctx);
    const targetUserId = this.getOptionalUserId(values.userId);
    const range = this.getDateRange(values);
    const scheduleRecords = await ctx.db.getRepository(SCHEDULES_COLLECTION).find({
      filter: targetUserId ? { userId: targetUserId } : {},
      sort: ['startAt'],
      limit: 500,
    });
    const schedules = scheduleRecords
      .map((schedule) => this.recordToJSON(schedule))
      .filter((schedule) => !schedule?.isDeleted)
      .filter((schedule) => this.isScheduleInRange(schedule, range.startAt, range.endAt));

    ctx.body = {
      schedules: await this.enrichSchedules(ctx, schedules),
    };
    await next();
  };

  listUsers = async (ctx, next) => {
    const users = await this.listUserSummaries(ctx);
    const tokensByUserId = await this.getTokensByUserId(ctx);

    ctx.body = {
      users: users.map((user) => {
        const token = tokensByUserId.get(String(user.id));
        return {
          ...user,
          connected: Boolean(token?.isActive && token?.refreshToken),
          googleAccountEmail: token?.googleAccountEmail || '',
          selectedCalendarId: token?.selectedCalendarId || '',
        };
      }),
    };
    await next();
  };

  createSchedule = async (ctx, next) => {
    const values = this.getActionValues(ctx);
    const userId = this.normalizeUserId(values.userId || this.getCurrentUserId(ctx));
    this.requireScheduleOwnerOrAdmin(ctx, userId);
    const scheduleValues = this.buildScheduleValues(ctx, values);
    const tokenRecord = await this.requireTokenForUser(ctx, userId);
    const settings = await this.requireSettings(ctx);
    const accessToken = await this.ensureAccessToken(ctx, tokenRecord, settings);
    const tokenRepo = ctx.db.getRepository(TOKENS_COLLECTION);
    const primaryCalendar = await this.ensurePrimaryCalendar(ctx, tokenRepo, tokenRecord, accessToken);
    const scheduleRepo = ctx.db.getRepository(SCHEDULES_COLLECTION);
    const scheduleRecord = await scheduleRepo.create({
      values: {
        ...scheduleValues,
        userId,
        googleCalendarId: primaryCalendar.id,
        syncStatus: 'pending',
        syncSource: 'bizblock',
        isDeleted: false,
      },
    });

    try {
      const event = await this.createGoogleCalendarEvent(accessToken, primaryCalendar.id, scheduleValues);
      await this.updateScheduleWithGoogleEvent(ctx, scheduleRecord, primaryCalendar.id, event, 'bizblock');
      const syncedSchedule = await scheduleRepo.findOne({ filter: { id: this.getValue(scheduleRecord, 'id') } });
      ctx.body = { schedule: (await this.enrichSchedules(ctx, [this.recordToJSON(syncedSchedule)]))[0] };
    } catch (error) {
      await this.markScheduleSyncError(ctx, scheduleRecord, error);
      throw error;
    }

    await next();
  };

  updateSchedule = async (ctx, next) => {
    const params = this.getActionValues(ctx);
    const values = params.values || params;
    const scheduleId = params.id || values.id;
    if (!scheduleId) {
      ctx.throw(400, 'schedule id が必要です');
    }

    const scheduleRepo = ctx.db.getRepository(SCHEDULES_COLLECTION);
    const scheduleRecord = await scheduleRepo.findOne({ filter: { id: scheduleId } });
    const current = this.recordToJSON(scheduleRecord);
    if (!current || current.isDeleted) {
      ctx.throw(404, '予定が見つかりません');
    }
    this.requireScheduleOwnerOrAdmin(ctx, current.userId);
    if (values.userId && String(values.userId) !== String(current.userId)) {
      ctx.throw(400, '予定のユーザー変更は未対応です');
    }

    const scheduleValues = this.buildScheduleValues(ctx, values, current);
    await scheduleRepo.update({
      filter: { id: scheduleId },
      values: {
        ...scheduleValues,
        syncStatus: 'pending',
        syncSource: 'bizblock',
        lastError: '',
      },
    });

    const tokenRecord = await this.requireTokenForUser(ctx, current.userId);
    const settings = await this.requireSettings(ctx);
    const accessToken = await this.ensureAccessToken(ctx, tokenRecord, settings);
    const tokenRepo = ctx.db.getRepository(TOKENS_COLLECTION);
    const primaryCalendar = await this.ensurePrimaryCalendar(ctx, tokenRepo, tokenRecord, accessToken);
    const calendarId = current.googleCalendarId || primaryCalendar.id;

    try {
      const event = current.googleEventId
        ? await this.updateGoogleCalendarEvent(accessToken, calendarId, current.googleEventId, scheduleValues)
        : await this.createGoogleCalendarEvent(accessToken, primaryCalendar.id, scheduleValues);
      await this.updateScheduleWithGoogleEvent(
        ctx,
        scheduleRecord,
        current.googleEventId ? calendarId : primaryCalendar.id,
        event,
        'bizblock',
      );
      const syncedSchedule = await scheduleRepo.findOne({ filter: { id: scheduleId } });
      ctx.body = { schedule: (await this.enrichSchedules(ctx, [this.recordToJSON(syncedSchedule)]))[0] };
    } catch (error) {
      await this.markScheduleSyncError(ctx, scheduleRecord, error);
      throw error;
    }

    await next();
  };

  deleteSchedule = async (ctx, next) => {
    const values = this.getActionValues(ctx);
    const scheduleId = values.id;
    if (!scheduleId) {
      ctx.throw(400, 'schedule id が必要です');
    }

    const scheduleRepo = ctx.db.getRepository(SCHEDULES_COLLECTION);
    const scheduleRecord = await scheduleRepo.findOne({ filter: { id: scheduleId } });
    const schedule = this.recordToJSON(scheduleRecord);
    if (!schedule || schedule.isDeleted) {
      ctx.throw(404, '予定が見つかりません');
    }
    this.requireScheduleOwnerOrAdmin(ctx, schedule.userId);

    const tokenRecord = await this.requireTokenForUser(ctx, schedule.userId);
    const settings = await this.requireSettings(ctx);
    const accessToken = await this.ensureAccessToken(ctx, tokenRecord, settings);

    try {
      if (schedule.googleCalendarId && schedule.googleEventId) {
        await this.deleteGoogleCalendarEvent(accessToken, schedule.googleCalendarId, schedule.googleEventId);
      }
      await scheduleRepo.update({
        filter: { id: scheduleId },
        values: {
          isDeleted: true,
          deletedAt: new Date(),
          syncStatus: 'deleted',
          syncSource: 'bizblock',
          lastSyncedAt: new Date(),
          lastError: '',
        },
      });
      ctx.body = { ok: true };
    } catch (error) {
      await this.markScheduleSyncError(ctx, scheduleRecord, error);
      throw error;
    }

    await next();
  };

  syncFromGoogle = async (ctx, next) => {
    const values = this.getActionValues(ctx);
    const currentUserId = this.getCurrentUserId(ctx);
    const requestedUserId = this.getOptionalUserId(values.userId);
    const targetUserId = this.isAdmin(ctx) ? requestedUserId : currentUserId;
    if (!this.isAdmin(ctx) && requestedUserId && !this.isSameUserId(requestedUserId, currentUserId)) {
      ctx.throw(403, '他ユーザーの予定は同期できません');
    }
    const range = this.getDateRange(values);
    const tokenRecords = await this.getSyncTokenRecords(ctx, targetUserId);
    const settings = await this.requireSettings(ctx);
    const tokenRepo = ctx.db.getRepository(TOKENS_COLLECTION);
    const result = {
      users: tokenRecords.length,
      fetched: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [] as { userId: string | number; message: string }[],
    };

    if (!tokenRecords.length) {
      ctx.throw(400, 'Google連携済みユーザーが見つかりません');
    }

    for (const tokenRecord of tokenRecords) {
      const userId = this.getValue(tokenRecord, 'userId');
      try {
        const accessToken = await this.ensureAccessToken(ctx, tokenRecord, settings);
        const primaryCalendar = await this.ensurePrimaryCalendar(ctx, tokenRepo, tokenRecord, accessToken);
        const events = await this.fetchGoogleCalendarEvents(
          accessToken,
          primaryCalendar.id,
          range.startAt,
          range.endAt,
        );
        result.fetched += events.length;

        for (const event of events) {
          const eventResult = await this.upsertScheduleFromGoogleEvent(ctx, userId, primaryCalendar, event);
          result[eventResult] += 1;
        }

        await tokenRepo.update({
          filter: { id: this.getValue(tokenRecord, 'id') },
          values: {
            lastFetchedAt: new Date(),
            selectedCalendarId: primaryCalendar.id,
            isActive: true,
          },
        });
      } catch (error) {
        result.errors.push({
          userId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    ctx.body = result;
    await next();
  };

  disconnect = async (ctx, next) => {
    const userId = this.getCurrentUserId(ctx);
    await ctx.db.getRepository(TOKENS_COLLECTION).destroy({ filter: { userId } });
    ctx.body = { ok: true };
    await next();
  };

  private async readSettings() {
    const record = await this.db.getRepository(SETTINGS_COLLECTION).findOne();
    return this.recordToJSON(record) || {};
  }

  private async requireSettings(ctx) {
    const settings = await this.readSettings();
    if (!settings.clientId || !settings.clientSecret) {
      ctx.throw(400, 'Google OAuth client ID / client secret を保存してください');
    }
    return settings;
  }

  private getCurrentUserId(ctx) {
    const userId = ctx.auth?.user?.id || ctx.state?.currentUser?.id;
    if (!userId) {
      ctx.throw(401, 'ログインユーザーを取得できません');
    }
    return userId;
  }

  private isAdmin(ctx) {
    const roles = ctx.state?.currentRoles || [];
    const role = ctx.state?.currentRole;
    return roles.includes('root') || roles.includes('admin') || role === 'root' || role === 'admin';
  }

  private requireAdmin(ctx) {
    if (!this.isAdmin(ctx)) {
      ctx.throw(403, '管理者のみ操作できます');
    }
  }

  private requireScheduleOwnerOrAdmin(ctx, userId) {
    if (this.isAdmin(ctx)) {
      return;
    }
    if (!this.isSameUserId(userId, this.getCurrentUserId(ctx))) {
      ctx.throw(403, '他ユーザーの予定は操作できません');
    }
  }

  private isSameUserId(a, b) {
    return String(a) === String(b);
  }

  private getActionValues(ctx) {
    return ctx.action?.params?.values || {};
  }

  private normalizeUserId(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }

  private getOptionalUserId(value) {
    if (!value || value === 'all') {
      return null;
    }
    return this.normalizeUserId(value);
  }

  private getDateRange(values) {
    const fallbackStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fallbackEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const startAt = values.startAt ? new Date(values.startAt) : fallbackStart;
    const endAt = values.endAt ? new Date(values.endAt) : fallbackEnd;

    return {
      startAt: this.isValidDate(startAt) ? startAt : fallbackStart,
      endAt: this.isValidDate(endAt) ? endAt : fallbackEnd,
    };
  }

  private isScheduleInRange(schedule, startAt: Date, endAt: Date) {
    const scheduleStart = new Date(schedule.startAt);
    const scheduleEnd = new Date(schedule.endAt);
    if (!this.isValidDate(scheduleStart) || !this.isValidDate(scheduleEnd)) {
      return false;
    }
    return scheduleStart.getTime() <= endAt.getTime() && scheduleEnd.getTime() >= startAt.getTime();
  }

  private async listUserSummaries(ctx) {
    const users = await ctx.db.getRepository('users').find({
      fields: ['id', 'nickname', 'username', 'email'],
      sort: ['id'],
      limit: 500,
    });

    return users.map((user) => {
      const data = this.recordToJSON(user);
      return {
        id: data.id,
        nickname: data.nickname || '',
        username: data.username || '',
        email: data.email || '',
        displayName: data.nickname || data.username || data.email || `User #${data.id}`,
      };
    });
  }

  private async getTokensByUserId(ctx) {
    const tokens = await ctx.db.getRepository(TOKENS_COLLECTION).find({
      sort: ['userId'],
      limit: 500,
    });
    const entries: [string, any][] = tokens.map((token) => {
      const data = this.recordToJSON(token);
      return [String(data.userId), data];
    });
    return new Map<string, any>(entries);
  }

  private async enrichSchedules(ctx, schedules) {
    const users = await this.listUserSummaries(ctx);
    const usersById = new Map(users.map((user) => [String(user.id), user]));
    const tokensByUserId = await this.getTokensByUserId(ctx);

    return schedules.map((schedule) => {
      const user = usersById.get(String(schedule.userId));
      const token = tokensByUserId.get(String(schedule.userId));
      return {
        ...schedule,
        user: user || {
          id: schedule.userId,
          displayName: `User #${schedule.userId}`,
        },
        googleAccountEmail: token?.googleAccountEmail || '',
      };
    });
  }

  private async requireTokenForUser(ctx, userId) {
    const tokenRecord = await ctx.db.getRepository(TOKENS_COLLECTION).findOne({ filter: { userId } });
    if (!tokenRecord || !this.getValue(tokenRecord, 'refreshToken')) {
      ctx.throw(400, `ユーザー ${userId} のGoogle認証がまだ完了していません`);
    }
    return tokenRecord;
  }

  private async getSyncTokenRecords(ctx, userId = null) {
    const tokenRecords = await ctx.db.getRepository(TOKENS_COLLECTION).find({
      filter: userId ? { userId } : {},
      sort: ['userId'],
      limit: 500,
    });

    return tokenRecords.filter((tokenRecord) => {
      const token = this.recordToJSON(tokenRecord);
      return token?.isActive && token?.refreshToken;
    });
  }

  private buildScheduleValues(ctx, values, current: any = {}) {
    const startAt = values.startAt !== undefined ? new Date(values.startAt) : new Date(current.startAt);
    const endAt = values.endAt !== undefined ? new Date(values.endAt) : new Date(current.endAt);
    const title = String(values.title ?? current.title ?? '').trim();
    const timeZone = String(values.timeZone ?? current.timeZone ?? 'Asia/Tokyo').trim() || 'Asia/Tokyo';

    if (!title) {
      ctx.throw(400, '予定タイトルを入力してください');
    }
    if (!this.isValidDate(startAt) || !this.isValidDate(endAt)) {
      ctx.throw(400, '開始日時または終了日時が不正です');
    }
    if (endAt.getTime() <= startAt.getTime()) {
      ctx.throw(400, '終了日時は開始日時より後にしてください');
    }

    return {
      title,
      description: String(values.description ?? current.description ?? '').trim(),
      startAt,
      endAt,
      timeZone,
      location: String(values.location ?? current.location ?? '').trim(),
      isAllDay: Boolean(values.isAllDay ?? current.isAllDay ?? false),
    };
  }

  private getDefaultRedirectUri(ctx) {
    const headerHost = ctx.get?.('x-forwarded-host') || ctx.get?.('host') || ctx.request?.headers?.host;
    const headerProto = ctx.get?.('x-forwarded-proto') || ctx.protocol || ctx.request?.protocol || 'http';
    const origin =
      ctx.origin && ctx.origin !== 'null' ? ctx.origin : `${headerProto}://${headerHost || '127.0.0.1:13000'}`;
    return `${origin}/api/${RESOURCE_NAME}:callback`;
  }

  private async exchangeAuthorizationCode(params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) {
    return this.requestJson<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    }>(
      GOOGLE_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: params.code,
          client_id: params.clientId,
          client_secret: params.clientSecret,
          redirect_uri: params.redirectUri,
          grant_type: 'authorization_code',
        }),
      },
      'Google token exchange failed',
    );
  }

  private async ensureAccessToken(ctx, tokenRecord, settings) {
    const tokenExpiry = this.getValue(tokenRecord, 'tokenExpiry');
    const currentAccessToken = this.getValue(tokenRecord, 'accessToken');

    if (currentAccessToken && tokenExpiry && new Date(tokenExpiry).getTime() > Date.now() + 60 * 1000) {
      return currentAccessToken;
    }

    const refreshToken = this.getValue(tokenRecord, 'refreshToken');
    if (!refreshToken) {
      ctx.throw(400, 'refresh_token がありません。再認証してください');
    }

    const refreshed = await this.requestJson<{
      access_token: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    }>(
      GOOGLE_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      },
      'Google token refresh failed',
    );

    await ctx.db.getRepository(TOKENS_COLLECTION).update({
      filter: { id: this.getValue(tokenRecord, 'id') },
      values: {
        accessToken: refreshed.access_token,
        tokenExpiry: this.getTokenExpiry(refreshed.expires_in),
        scope: refreshed.scope || this.getValue(tokenRecord, 'scope'),
        isActive: true,
      },
    });

    return refreshed.access_token;
  }

  private async fetchGoogleAccountEmail(accessToken: string) {
    try {
      const data = await this.requestJson<{ email?: string }>(
        GOOGLE_USERINFO_URL,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        'Google userinfo failed',
      );
      return data.email || '';
    } catch (error) {
      this.app.logger?.warn?.(
        `[googleCalendarSync] userinfo failed: ${error instanceof Error ? error.message : error}`,
      );
      return '';
    }
  }

  private async fetchCalendarList(accessToken: string): Promise<GoogleCalendarSummary[]> {
    const data = await this.requestJson<{ items?: any[] }>(
      GOOGLE_CALENDAR_LIST_URL,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      'Google Calendar list failed',
    );

    return (data.items || []).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summary,
      primary: calendar.primary,
      accessRole: calendar.accessRole,
      timeZone: calendar.timeZone,
    }));
  }

  private async ensurePrimaryCalendar(
    ctx,
    tokenRepo,
    tokenRecord,
    accessToken: string,
  ): Promise<GoogleCalendarSummary> {
    const token = this.recordToJSON(tokenRecord) || {};
    const storedCalendars = Array.isArray(token.calendars) ? token.calendars : [];
    const storedPrimary = storedCalendars.find((calendar) => calendar.primary && calendar.id);
    if (storedPrimary) {
      return storedPrimary;
    }

    const calendars = await this.fetchCalendarList(accessToken);
    const primaryCalendar = calendars.find((calendar) => calendar.primary && calendar.id);
    if (!primaryCalendar) {
      ctx.throw(400, 'primary カレンダーが見つかりません。カレンダー一覧を更新してから再実行してください');
    }

    await tokenRepo.update({
      filter: { id: this.getValue(tokenRecord, 'id') },
      values: {
        calendars,
        selectedCalendarId: primaryCalendar.id,
        lastFetchedAt: new Date(),
        isActive: true,
      },
    });

    return primaryCalendar;
  }

  private async createGoogleCalendarEvent(
    accessToken: string,
    calendarId: string,
    schedule: {
      title: string;
      description?: string;
      startAt: Date;
      endAt: Date;
      timeZone: string;
      location?: string;
    },
  ): Promise<GoogleCalendarEvent> {
    return this.requestJson<GoogleCalendarEvent>(
      `${GOOGLE_CALENDAR_EVENTS_BASE_URL}/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: schedule.title,
          description: schedule.description || '',
          location: schedule.location || '',
          start: {
            dateTime: schedule.startAt.toISOString(),
            timeZone: schedule.timeZone,
          },
          end: {
            dateTime: schedule.endAt.toISOString(),
            timeZone: schedule.timeZone,
          },
        }),
      },
      'Google Calendar event insert failed',
    );
  }

  private async updateGoogleCalendarEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    schedule: {
      title: string;
      description?: string;
      startAt: Date;
      endAt: Date;
      timeZone: string;
      location?: string;
    },
  ): Promise<GoogleCalendarEvent> {
    return this.requestJson<GoogleCalendarEvent>(
      `${GOOGLE_CALENDAR_EVENTS_BASE_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: schedule.title,
          description: schedule.description || '',
          location: schedule.location || '',
          start: {
            dateTime: schedule.startAt.toISOString(),
            timeZone: schedule.timeZone,
          },
          end: {
            dateTime: schedule.endAt.toISOString(),
            timeZone: schedule.timeZone,
          },
        }),
      },
      'Google Calendar event update failed',
    );
  }

  private async deleteGoogleCalendarEvent(accessToken: string, calendarId: string, eventId: string) {
    const response = await fetch(
      `${GOOGLE_CALENDAR_EVENTS_BASE_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (response.ok || response.status === 404 || response.status === 410) {
      return;
    }

    const text = await response.text();
    const data = text ? this.safeJsonParse(text) : {};
    const message = data?.error?.message || data?.error || text || `${response.status} ${response.statusText}`;
    throw new Error(`Google Calendar event delete failed: ${message}`);
  }

  private async fetchGoogleCalendarEvents(
    accessToken: string,
    calendarId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<GoogleCalendarListEvent[]> {
    const events: GoogleCalendarListEvent[] = [];
    let pageToken = '';

    do {
      const url = new URL(`${GOOGLE_CALENDAR_EVENTS_BASE_URL}/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'true');
      url.searchParams.set('maxResults', '2500');
      url.searchParams.set('timeMin', startAt.toISOString());
      url.searchParams.set('timeMax', endAt.toISOString());
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const data = await this.requestJson<{ items?: GoogleCalendarListEvent[]; nextPageToken?: string }>(
        url.toString(),
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        'Google Calendar events list failed',
      );

      events.push(...(data.items || []));
      pageToken = data.nextPageToken || '';
    } while (pageToken && events.length < 10000);

    return events;
  }

  private async updateScheduleWithGoogleEvent(
    ctx,
    scheduleRecord,
    calendarId: string,
    event: GoogleCalendarEvent,
    source: string,
  ) {
    if (!event.id) {
      ctx.throw(502, 'Google Calendar event id を取得できませんでした');
    }

    await ctx.db.getRepository(SCHEDULES_COLLECTION).update({
      filter: { id: this.getValue(scheduleRecord, 'id') },
      values: {
        googleCalendarId: calendarId,
        googleEventId: event.id,
        googleEventEtag: event.etag || '',
        googleUpdatedAt: event.updated ? new Date(event.updated) : null,
        googleHtmlLink: event.htmlLink || '',
        syncStatus: 'synced',
        syncSource: source,
        isDeleted: false,
        deletedAt: null,
        lastSyncedAt: new Date(),
        lastError: '',
      },
    });
  }

  private async markScheduleSyncError(ctx, scheduleRecord, error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db.getRepository(SCHEDULES_COLLECTION).update({
      filter: { id: this.getValue(scheduleRecord, 'id') },
      values: {
        syncStatus: 'error',
        lastError: message,
      },
    });
  }

  private async upsertScheduleFromGoogleEvent(
    ctx,
    userId: number | string,
    calendar: GoogleCalendarSummary,
    event: GoogleCalendarListEvent,
  ): Promise<'created' | 'updated' | 'deleted' | 'skipped'> {
    if (!event.id) {
      return 'skipped';
    }

    const scheduleRepo = ctx.db.getRepository(SCHEDULES_COLLECTION);
    const existing = await scheduleRepo.findOne({ filter: { userId, googleEventId: event.id } });
    const existingData = this.recordToJSON(existing);

    if (event.status === 'cancelled') {
      if (!existing) {
        return 'skipped';
      }
      await scheduleRepo.update({
        filter: { id: existingData.id },
        values: {
          isDeleted: true,
          deletedAt: new Date(),
          syncStatus: 'deleted',
          syncSource: 'google',
          googleUpdatedAt: event.updated ? new Date(event.updated) : existingData.googleUpdatedAt,
          lastSyncedAt: new Date(),
          lastError: '',
        },
      });
      return 'deleted';
    }

    const scheduleValues = this.googleEventToScheduleValues(event, calendar.timeZone || 'Asia/Tokyo');
    if (!scheduleValues) {
      return 'skipped';
    }

    const values = {
      ...scheduleValues,
      userId,
      googleCalendarId: calendar.id,
      googleEventId: event.id,
      googleEventEtag: event.etag || '',
      googleUpdatedAt: event.updated ? new Date(event.updated) : null,
      googleHtmlLink: event.htmlLink || '',
      syncStatus: 'synced',
      syncSource: 'google',
      isDeleted: false,
      deletedAt: null,
      lastSyncedAt: new Date(),
      lastError: '',
    };

    if (existing) {
      await scheduleRepo.update({ filter: { id: existingData.id }, values });
      return 'updated';
    }

    await scheduleRepo.create({ values });
    return 'created';
  }

  private googleEventToScheduleValues(event: GoogleCalendarListEvent, fallbackTimeZone: string) {
    const isAllDay = Boolean(event.start?.date);
    const timeZone = event.start?.timeZone || event.end?.timeZone || fallbackTimeZone || 'Asia/Tokyo';
    const startAt = this.parseGoogleEventDate(event.start, timeZone);
    const endAt = this.parseGoogleEventDate(event.end, timeZone);

    if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
      return null;
    }

    return {
      title: String(event.summary || '(無題)').trim(),
      description: String(event.description || '').trim(),
      startAt,
      endAt,
      timeZone,
      location: String(event.location || '').trim(),
      isAllDay,
    };
  }

  private parseGoogleEventDate(value, timeZone: string) {
    if (!value) {
      return null;
    }
    if (value.dateTime) {
      const date = new Date(value.dateTime);
      return this.isValidDate(date) ? date : null;
    }
    if (value.date) {
      const date = new Date(`${value.date}T00:00:00${timeZone === 'Asia/Tokyo' ? '+09:00' : ''}`);
      return this.isValidDate(date) ? date : null;
    }
    return null;
  }

  private async saveToken(
    ctx,
    params: {
      userId: number | string;
      token: {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      googleAccountEmail: string;
      calendars: GoogleCalendarSummary[];
    },
  ) {
    const repo = ctx.db.getRepository(TOKENS_COLLECTION);
    const existing = await repo.findOne({ filter: { userId: params.userId } });
    const existingJson = this.recordToJSON(existing);
    const selectedCalendarId =
      params.calendars.find((calendar) => calendar.primary)?.id ||
      existingJson?.selectedCalendarId ||
      params.calendars[0]?.id ||
      '';

    const values = {
      userId: params.userId,
      googleAccountEmail: params.googleAccountEmail || existingJson?.googleAccountEmail || '',
      accessToken: params.token.access_token,
      refreshToken: params.token.refresh_token || existingJson?.refreshToken || '',
      tokenExpiry: this.getTokenExpiry(params.token.expires_in),
      scope: params.token.scope || GOOGLE_SCOPES.join(' '),
      calendars: params.calendars,
      selectedCalendarId,
      isActive: true,
      lastFetchedAt: new Date(),
    };

    if (existing) {
      await repo.update({ filter: { id: this.getValue(existing, 'id') }, values });
    } else {
      await repo.create({ values });
    }
  }

  private getTokenExpiry(expiresIn?: number) {
    return new Date(Date.now() + Math.max(Number(expiresIn || 3600) - 60, 60) * 1000);
  }

  private isValidDate(value: Date) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  private async requestJson<T>(url: string, init: RequestInit, errorPrefix: string): Promise<T> {
    const response = await fetch(url, init);
    const text = await response.text();
    const data = text ? this.safeJsonParse(text) : {};

    if (!response.ok) {
      const message =
        data?.error_description ||
        data?.error?.message ||
        data?.error ||
        text ||
        `${response.status} ${response.statusText}`;
      throw new Error(`${errorPrefix}: ${message}`);
    }

    return data as T;
  }

  private safeJsonParse(text: string) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return { raw: text };
    }
  }

  private recordToJSON(record) {
    return record?.toJSON ? record.toJSON() : record;
  }

  private getValue(record, key: string) {
    if (!record) {
      return undefined;
    }
    return typeof record.get === 'function' ? record.get(key) : record[key];
  }

  private renderCallbackHtml(title: string, detail: string) {
    const safeTitle = this.escapeHtml(title);
    const safeDetail = this.escapeHtml(detail);
    return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 48px; color: #1f2933; }
      main { max-width: 720px; }
      h1 { font-size: 24px; line-height: 1.35; }
      p { font-size: 14px; line-height: 1.7; color: #52616b; }
      code { background: #f3f5f7; border-radius: 4px; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDetail}</p>
      <p>NocoBase の Google Calendar Sync 設定画面に戻り、カレンダー一覧を更新してください。</p>
    </main>
  </body>
</html>`;
  }

  private escapeHtml(value: string) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export default BizBlockGoogleCalendarSyncServer;

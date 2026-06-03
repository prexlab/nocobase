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

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
};

export class BizBlockGoogleCalendarSyncServer extends Plugin {
  async load() {
    this.app.resourceManager.define({
      name: 'googleCalendarPoc',
      actions: {
        getSettings: this.getSettings,
        setSettings: this.setSettings,
        authorize: this.authorize,
        callback: this.callback,
        status: this.status,
        listCalendars: this.listCalendars,
        disconnect: this.disconnect,
      },
    });

    this.app.acl.allow(
      'googleCalendarPoc',
      ['getSettings', 'setSettings', 'authorize', 'status', 'listCalendars', 'disconnect'],
      'loggedIn',
    );
    this.app.acl.allow('googleCalendarPoc', 'callback', 'public');
    this.app.acl.registerSnippet({
      name: `pm.${this.name}.google-calendar-poc`,
      actions: ['googleCalendarPoc:*'],
    });
  }

  getSettings = async (ctx, next) => {
    const settings = await this.readSettings();
    ctx.body = {
      clientId: settings.clientId || '',
      redirectUri: settings.redirectUri || '',
      defaultRedirectUri: this.getDefaultRedirectUri(ctx),
      hasClientSecret: Boolean(settings.clientSecret),
      scopes: GOOGLE_SCOPES,
    };
    await next();
  };

  setSettings = async (ctx, next) => {
    const repo = ctx.db.getRepository('googleCalendarPocSettings');
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

    await ctx.db.getRepository('googleCalendarPocStates').create({
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

      const stateRepo = ctx.db.getRepository('googleCalendarPocStates');
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
      this.app.logger?.warn?.(`[googleCalendarPoc] OAuth callback failed: ${message}`);
      ctx.body = this.renderCallbackHtml('Google カレンダー連携に失敗しました', message);
    }

    await next();
  };

  status = async (ctx, next) => {
    const userId = this.getCurrentUserId(ctx);
    const settings = await this.readSettings();
    const tokenRecord = await ctx.db.getRepository('googleCalendarPocTokens').findOne({ filter: { userId } });
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
    };
    await next();
  };

  listCalendars = async (ctx, next) => {
    const userId = this.getCurrentUserId(ctx);
    const settings = await this.requireSettings(ctx);
    const tokenRepo = ctx.db.getRepository('googleCalendarPocTokens');
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

  disconnect = async (ctx, next) => {
    const userId = this.getCurrentUserId(ctx);
    await ctx.db.getRepository('googleCalendarPocTokens').destroy({ filter: { userId } });
    ctx.body = { ok: true };
    await next();
  };

  private async readSettings() {
    const record = await this.db.getRepository('googleCalendarPocSettings').findOne();
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

  private getDefaultRedirectUri(ctx) {
    const headerHost = ctx.get?.('x-forwarded-host') || ctx.get?.('host') || ctx.request?.headers?.host;
    const headerProto = ctx.get?.('x-forwarded-proto') || ctx.protocol || ctx.request?.protocol || 'http';
    const origin =
      ctx.origin && ctx.origin !== 'null' ? ctx.origin : `${headerProto}://${headerHost || '127.0.0.1:13000'}`;
    return `${origin}/api/googleCalendarPoc:callback`;
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

    await ctx.db.getRepository('googleCalendarPocTokens').update({
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
      this.app.logger?.warn?.(`[googleCalendarPoc] userinfo failed: ${error instanceof Error ? error.message : error}`);
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
    const repo = ctx.db.getRepository('googleCalendarPocTokens');
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
      <p>NocoBase の Google Calendar PoC 設定画面に戻り、カレンダー一覧を更新してください。</p>
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

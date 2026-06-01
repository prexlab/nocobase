/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { ResourcerContext } from '@nocobase/resourcer';
import { parseFilter } from '@nocobase/utils';

type CanResult = {
  params?: {
    fields?: string[];
    appends?: string[];
    filter?: unknown;
    own?: boolean;
  };
};

type AclLike = {
  can?: (options: { roles: string[]; resource: string; action: string; rawResourceName?: string }) => CanResult | null;
};

type RecordReadPolicyOptions = {
  skipAcl?: boolean;
  rawResourceName?: string;
  projectionDepth?: number;
};

export type RecordReadProjection = {
  fields?: string[];
  associations?: Record<string, RecordReadProjection>;
};

export type RecordReadPolicy = {
  allowed: boolean;
  fields?: string[];
  appends?: string[];
  filter?: unknown;
  associationFilters?: Record<string, unknown>;
  projection?: RecordReadProjection;
  preferFullRecord?: boolean;
};

const SENSITIVE_FIELD_PATTERN = /(?:password|token|secret|credential|api[-_]?key|access[-_]?key|private[-_]?key)/i;
const MAX_ASSOCIATION_PROJECTION_DEPTH = 3;

function uniq(list: string[]) {
  return Array.from(new Set(list));
}

function getTopSegment(path: string) {
  return String(path || '')
    .replace(/^\./, '')
    .split(/[.[\]]/)
    .filter(Boolean)[0];
}

function isSensitivePath(path: string) {
  return String(path || '')
    .split(/[.[\]]/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_FIELD_PATTERN.test(segment));
}

function getRoles(ctx: ResourcerContext) {
  const state = ctx.state as
    | {
        currentRoles?: string[];
        currentRole?: string;
      }
    | undefined;
  if (Array.isArray(state?.currentRoles) && state.currentRoles.length) return state.currentRoles;
  if (state?.currentRole) return [state.currentRole];

  const auth = (ctx as ResourcerContext & { auth?: { role?: string } }).auth;
  if (auth?.role) return [auth.role];
  return ['anonymous'];
}

function getAcl(ctx: ResourcerContext, dataSourceKey: string): AclLike | undefined {
  const dataSourceAcl = ctx.app?.dataSourceManager?.get?.(dataSourceKey || 'main')?.acl;
  const requestAcl = (ctx as ResourcerContext & { acl?: AclLike }).acl;
  const appAcl = ctx.app?.acl;
  return [dataSourceAcl, requestAcl, appAcl].find((acl) => typeof acl?.can === 'function') as AclLike | undefined;
}

function getCollectionAttributeNames(ctx: ResourcerContext, dataSourceKey: string, collectionName: string) {
  const collection = getCollection(ctx, dataSourceKey, collectionName);
  const rawAttributes = collection?.model?.rawAttributes as Record<string, unknown> | undefined;
  if (rawAttributes && typeof rawAttributes === 'object') {
    return Object.keys(rawAttributes);
  }
  return undefined;
}

function getDb(ctx: ResourcerContext, dataSourceKey: string) {
  return ctx.app?.dataSourceManager?.get?.(dataSourceKey || 'main')?.collectionManager?.db || ctx.db;
}

function getCollection(ctx: ResourcerContext, dataSourceKey: string, collectionName: string) {
  return getDb(ctx, dataSourceKey)?.getCollection?.(collectionName);
}

function getTimezone(ctx: ResourcerContext) {
  const request = ctx.request as
    | {
        get?: (name: string) => string | undefined;
        header?: Record<string, string | undefined>;
      }
    | undefined;
  return request?.get?.('x-timezone') ?? request?.header?.['x-timezone'] ?? ctx.req?.headers?.['x-timezone'];
}

function getCurrentUser(ctx: ResourcerContext) {
  const state = ctx.state as { currentUser?: { id?: unknown } } | undefined;
  if (state?.currentUser) return state.currentUser;
  return (ctx as ResourcerContext & { auth?: { user?: { id?: unknown } } }).auth?.user;
}

function containsCreatedByIdFilter(input: unknown, seen = new Set<object>()): boolean {
  if (!input || typeof input !== 'object') return false;
  if (Array.isArray(input)) return input.some((item) => containsCreatedByIdFilter(item, seen));

  const record = input as Record<string, unknown>;
  if (seen.has(record)) return false;
  seen.add(record);

  for (const [key, value] of Object.entries(record)) {
    if (key === 'createdById' || key.startsWith('createdById.') || key.startsWith('createdById$')) return true;
    if (containsCreatedByIdFilter(value, seen)) return true;
  }
  return false;
}

function collectionHasField(ctx: ResourcerContext, dataSourceKey: string, collectionName: string, fieldName: string) {
  const collection = getCollection(ctx, dataSourceKey, collectionName);
  const rawAttributes = collection?.model?.rawAttributes as Record<string, unknown> | undefined;
  return !!(
    collection?.getField?.(fieldName) ||
    (rawAttributes && Object.prototype.hasOwnProperty.call(rawAttributes, fieldName))
  );
}

function createCurrentUserProvider(ctx: ResourcerContext, dataSourceKey: string) {
  const db = getDb(ctx, dataSourceKey);
  const currentUser = getCurrentUser(ctx);
  return async ({ fields }: { fields: string[] }) => {
    if (!db || !currentUser?.id || !Array.isArray(fields)) return undefined;
    const userFields = fields.filter((field) => field && db.getFieldByPath?.(`users.${field}`));
    if (!userFields.length) return undefined;
    return db.getRepository?.('users')?.findOne?.({
      filterByTk: currentUser.id,
      fields: userFields,
    });
  };
}

async function parsePermissionFilter(
  ctx: ResourcerContext,
  dataSourceKey: string,
  collectionName: string,
  filter: unknown,
) {
  if (!filter) return undefined;
  if (containsCreatedByIdFilter(filter) && !collectionHasField(ctx, dataSourceKey, collectionName, 'createdById')) {
    return undefined;
  }

  const state = JSON.parse(JSON.stringify(ctx.state || {}));
  if (!state.currentUser) {
    const currentUser = getCurrentUser(ctx);
    if (currentUser) state.currentUser = currentUser;
  }

  return await parseFilter(filter, {
    timezone: getTimezone(ctx),
    now: new Date().toISOString(),
    vars: {
      ctx: {
        state,
      },
      $user: createCurrentUserProvider(ctx, dataSourceKey),
      $nRole: () => state.currentRole,
    },
  });
}

function filterSensitive(items?: string[]) {
  if (!Array.isArray(items)) return items;
  return uniq(items.filter((item) => item && !isSensitivePath(item)));
}

function splitPath(path: string) {
  return String(path || '')
    .replace(/^\./, '')
    .split('.')
    .filter(Boolean);
}

function addMapValue(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function getAssociationTargetCollection(
  ctx: ResourcerContext,
  dataSourceKey: string,
  collectionName: string,
  associationName: string,
): string | undefined {
  const db = getDb(ctx, dataSourceKey);
  const collection = db?.getCollection?.(collectionName);
  const field = collection?.getField?.(associationName) as { target?: string } | undefined;
  if (field?.target) return field.target;

  const association = collection?.model?.associations?.[associationName] as { target?: { name?: string } } | undefined;
  const targetModelName = association?.target?.name;
  if (!targetModelName) return undefined;
  return db?.getCollectionByModelName?.(targetModelName)?.name || targetModelName;
}

function projectionHasContent(projection?: RecordReadProjection) {
  return !!(
    projection &&
    ((Array.isArray(projection.fields) && projection.fields.length > 0) ||
      Object.keys(projection.associations || {}).length > 0)
  );
}

function flattenProjectionFields(projection: RecordReadProjection, prefix = ''): string[] {
  const out: string[] = [];
  for (const field of projection.fields || []) {
    out.push(prefix ? `${prefix}.${field}` : field);
  }
  for (const [associationName, associationProjection] of Object.entries(projection.associations || {})) {
    out.push(
      ...flattenProjectionFields(associationProjection, prefix ? `${prefix}.${associationName}` : associationName),
    );
  }
  return uniq(out);
}

function flattenProjectionAppends(projection: RecordReadProjection, prefix = ''): string[] {
  const out: string[] = [];
  for (const [associationName, associationProjection] of Object.entries(projection.associations || {})) {
    const path = prefix ? `${prefix}.${associationName}` : associationName;
    out.push(path);
    out.push(...flattenProjectionAppends(associationProjection, path));
  }
  return uniq(out);
}

export function sanitizeRecordReadResult(
  value: unknown,
  projection?: RecordReadProjection,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const source =
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? (value as { toJSON: () => unknown }).toJSON()
      : value;

  if (source == null || typeof source !== 'object') return source;
  const target = source as object;
  if (seen.has(target)) return seen.get(target);

  if (Array.isArray(source)) {
    const output: unknown[] = [];
    seen.set(target, output);
    for (const item of source) {
      output.push(sanitizeRecordReadResult(item, projection, seen));
    }
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(target, output);
  const allowedFields = projection?.fields ? new Set(projection.fields) : undefined;
  const associationProjections = projection?.associations || {};

  for (const [key, item] of Object.entries(source as Record<string, unknown>)) {
    if (isSensitivePath(key)) continue;
    const associationProjection = associationProjections[key];
    if (projection && !allowedFields?.has(key) && !associationProjection) continue;
    const sanitized = sanitizeRecordReadResult(item, associationProjection, seen);
    if (typeof sanitized !== 'undefined') output[key] = sanitized;
  }
  return output;
}

function filterByPermission(items: string[] | undefined, permissionItems: string[] | undefined) {
  if (!Array.isArray(items)) return items;
  if (!Array.isArray(permissionItems)) return items;
  const allowed = new Set(permissionItems.map((item) => getTopSegment(item)).filter(Boolean));
  return uniq(items.filter((item) => allowed.has(getTopSegment(item))));
}

function buildFullRecordFields(
  ctx: ResourcerContext,
  dataSourceKey: string,
  collectionName: string,
  permissionFields?: string[],
) {
  const attributes = getCollectionAttributeNames(ctx, dataSourceKey, collectionName);
  if (!attributes?.length) return undefined;
  const nonSensitive = filterSensitive(attributes);
  return filterByPermission(nonSensitive, permissionFields);
}

async function buildRecordReadProjection(
  ctx: ResourcerContext,
  dataSourceKey: string,
  collectionName: string,
  fields?: string[],
  appends?: string[],
  options: RecordReadPolicyOptions = {},
  associationFilters: Record<string, unknown> = {},
  pathPrefix = '',
): Promise<RecordReadProjection> {
  const collection = getCollection(ctx, dataSourceKey, collectionName);
  const rawAttributes = (collection?.model?.rawAttributes as Record<string, unknown>) || {};
  const projection: RecordReadProjection = {
    fields: [],
    associations: {},
  };
  const nestedFields = new Map<string, string[]>();
  const nestedAppends = new Map<string, string[]>();
  const directAppends = new Set<string>();

  for (const field of fields || []) {
    const segments = splitPath(field);
    if (!segments.length) continue;
    const [first, ...rest] = segments;
    if (!rest.length) {
      if (Object.prototype.hasOwnProperty.call(rawAttributes, first)) {
        projection.fields.push(first);
      } else if (getAssociationTargetCollection(ctx, dataSourceKey, collectionName, first)) {
        directAppends.add(first);
      }
      continue;
    }
    if (getAssociationTargetCollection(ctx, dataSourceKey, collectionName, first)) {
      addMapValue(nestedFields, first, rest.join('.'));
    }
  }

  for (const append of appends || []) {
    const segments = splitPath(append);
    if (!segments.length) continue;
    const [first, ...rest] = segments;
    if (!getAssociationTargetCollection(ctx, dataSourceKey, collectionName, first)) continue;
    if (!rest.length) {
      directAppends.add(first);
    } else {
      addMapValue(nestedAppends, first, rest.join('.'));
    }
  }

  const depth = options.projectionDepth || 0;
  if (depth >= MAX_ASSOCIATION_PROJECTION_DEPTH) {
    projection.fields = uniq(projection.fields);
    return projection;
  }

  const associationNames = new Set([...nestedFields.keys(), ...nestedAppends.keys(), ...directAppends]);
  for (const associationName of associationNames) {
    const targetCollectionName = getAssociationTargetCollection(ctx, dataSourceKey, collectionName, associationName);
    if (!targetCollectionName) continue;

    const targetFields = nestedFields.get(associationName);
    const targetAppends = nestedAppends.get(associationName);
    const directOnly = directAppends.has(associationName) && !targetFields?.length && !targetAppends?.length;
    const targetPolicy = await applyRecordReadPolicy(
      ctx,
      dataSourceKey,
      targetCollectionName,
      targetFields?.length ? targetFields : undefined,
      targetAppends?.length ? targetAppends : undefined,
      directOnly,
      {
        ...options,
        rawResourceName: `${collectionName}.${associationName}`,
        projectionDepth: depth + 1,
      },
    );

    if (!targetPolicy.allowed || !projectionHasContent(targetPolicy.projection)) continue;
    const associationPath = pathPrefix ? `${pathPrefix}.${associationName}` : associationName;
    if (targetPolicy.filter) {
      associationFilters[associationPath] = targetPolicy.filter;
    }
    for (const [nestedPath, nestedFilter] of Object.entries(targetPolicy.associationFilters || {})) {
      associationFilters[`${associationPath}.${nestedPath}`] = nestedFilter;
    }
    projection.associations[associationName] = targetPolicy.projection;
  }

  projection.fields = uniq(projection.fields);
  if (!projection.fields.length) delete projection.fields;
  if (!Object.keys(projection.associations).length) delete projection.associations;
  return projection;
}

export async function applyRecordReadPolicy(
  ctx: ResourcerContext,
  dataSourceKey: string,
  collectionName: string,
  fields?: string[],
  appends?: string[],
  preferFullRecord?: boolean,
  options: RecordReadPolicyOptions = {},
): Promise<RecordReadPolicy> {
  const roles = getRoles(ctx);
  const acl = getAcl(ctx, dataSourceKey);
  const permission =
    options.skipAcl || roles.includes('root') || !acl?.can
      ? ({ params: undefined } as CanResult)
      : acl.can({ roles, resource: collectionName, action: 'view', rawResourceName: options.rawResourceName });

  if (!permission) {
    return { allowed: false };
  }

  const permissionFields = permission.params?.fields;
  const permissionAppends = permission.params?.appends;
  const permissionFilter =
    options.skipAcl || roles.includes('root') || !permission.params?.filter
      ? undefined
      : await parsePermissionFilter(ctx, dataSourceKey, collectionName, permission.params.filter);
  if (permission.params?.filter && typeof permissionFilter === 'undefined') {
    return { allowed: false };
  }
  const selectableAppends = permissionAppends || permissionFields;

  let safeFields = filterByPermission(filterSensitive(fields), permissionFields);
  const safeAppends = filterByPermission(filterSensitive(appends), selectableAppends);
  let safePreferFullRecord = preferFullRecord;

  if (preferFullRecord || !Array.isArray(fields)) {
    safeFields = buildFullRecordFields(ctx, dataSourceKey, collectionName, permissionFields);
    if (!safeFields) {
      return { allowed: false };
    }
    safePreferFullRecord = false;
  }

  const requestedFieldsDenied = Array.isArray(fields) && fields.length > 0 && (!safeFields || safeFields.length === 0);
  const requestedAppendsDenied =
    Array.isArray(appends) && appends.length > 0 && (!safeAppends || safeAppends.length === 0);

  if ((requestedFieldsDenied && !safeAppends?.length) || (requestedAppendsDenied && !safeFields?.length)) {
    return { allowed: false };
  }

  const associationFilters: Record<string, unknown> = {};
  const projection = await buildRecordReadProjection(
    ctx,
    dataSourceKey,
    collectionName,
    safeFields,
    safeAppends,
    options,
    associationFilters,
  );
  if (!projectionHasContent(projection)) {
    return { allowed: false };
  }

  safeFields = flattenProjectionFields(projection);
  const projectedAppends = flattenProjectionAppends(projection);

  return {
    allowed: true,
    fields: safeFields.length ? safeFields : projectedAppends.length ? [] : undefined,
    appends: projectedAppends.length ? projectedAppends : undefined,
    filter: permissionFilter,
    associationFilters: Object.keys(associationFilters).length ? associationFilters : undefined,
    projection,
    preferFullRecord: safePreferFullRecord,
  };
}

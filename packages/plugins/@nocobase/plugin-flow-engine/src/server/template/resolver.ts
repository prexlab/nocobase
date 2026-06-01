/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import 'ses';
import _ from 'lodash';
import { BASE_BLOCKED_IDENTIFIERS, lockdownSes } from '@nocobase/utils';
import { ServerBaseContext } from './contexts';

export type JSONValue = string | { [key: string]: JSONValue } | JSONValue[];

/**
 * 解析 JSON 模板中形如 {{ ... }} 的占位符（服务端解析）。
 * 仅支持以 ctx 开头的路径与表达式（如：{{ ctx.user.id }}、{{ ctx.record.roles[0].name }}）。
 * 无法解析或不受支持的表达式将原样保留。
 *
 * @param template 要解析的对象/数组/字符串模板
 * @param ctx 变量上下文（实现了所需属性/方法的代理对象）
 * @returns 解析后的结果，与输入结构相同
 */
export async function resolveJsonTemplate(template: JSONValue, ctx: any): Promise<any> {
  const compile = async (source: any): Promise<any> => {
    if (typeof source === 'string' && /\{\{.*?\}\}/.test(source)) {
      return await replacePlaceholders(source, ctx);
    }
    if (Array.isArray(source)) return Promise.all(source.map(compile));
    if (source && typeof source === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(source)) out[k] = await compile(v);
      return out;
    }
    return source;
  };
  return compile(template);
}

const BLOCKED_CONTEXT_KEYS = new Set([
  'acl',
  'action',
  'app',
  'constructor',
  'database',
  'db',
  'emit',
  'emitAsync',
  'getCurrentRepository',
  'koaCtx',
  'permission',
  'prototype',
  'req',
  'request',
  'res',
  'response',
  'sequelize',
  'state',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  '__proto__',
]);

const BLOCKED_SANDBOX_GLOBALS = [
  ...BASE_BLOCKED_IDENTIFIERS,
  'process',
  'require',
  'module',
  'exports',
  '__filename',
  '__dirname',
  'Buffer',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
];

let templateSesLockdownReady = false;

function ensureTemplateSesLockdown() {
  if (templateSesLockdownReady) return;
  lockdownSes({
    consoleTaming: 'unsafe',
    errorTaming: 'unsafe',
    overrideTaming: 'moderate',
    stackFiltering: 'verbose',
  });
  templateSesLockdownReady = true;
}

function isBlockedContextKey(key: unknown) {
  if (typeof key === 'symbol') return key !== Symbol.iterator;
  return typeof key !== 'string' || key.startsWith('_') || BLOCKED_CONTEXT_KEYS.has(key);
}

function getContextInternals(ctx: unknown): {
  props?: Record<string, unknown>;
  methods?: Record<string, (...args: unknown[]) => unknown>;
  delegates?: unknown[];
} {
  if (!ctx || typeof ctx !== 'object') return {};
  const record = ctx as Record<string, unknown>;
  return {
    props: record._props as Record<string, unknown> | undefined,
    methods: record._methods as Record<string, (...args: unknown[]) => unknown> | undefined,
    delegates: record._delegates as unknown[] | undefined,
  };
}

function hasContextMember(ctx: unknown, key: string): boolean {
  const { props, methods, delegates } = getContextInternals(ctx);
  if (props && Object.prototype.hasOwnProperty.call(props, key)) return true;
  if (methods && Object.prototype.hasOwnProperty.call(methods, key)) return true;
  if (Array.isArray(delegates) && delegates.some((delegate) => hasContextMember(delegate, key))) return true;
  if (!props && !methods && !delegates && ctx && typeof ctx === 'object') {
    return Object.prototype.hasOwnProperty.call(ctx, key);
  }
  return false;
}

function createSafeValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value == null) return value;
  if (typeof value !== 'object' && typeof value !== 'function') return value;

  if (value instanceof Date) return value.toISOString();

  if (typeof (value as { then?: unknown }).then === 'function') {
    return (value as Promise<unknown>).then((resolved) => createSafeValue(resolved, seen));
  }

  const target = value as object;
  if (seen.has(target)) return seen.get(target);

  if (typeof value === 'function') {
    const safeFn = new Proxy(value as (...args: unknown[]) => unknown, {
      apply(fn, thisArg, argArray) {
        return createSafeValue(Reflect.apply(fn, thisArg, argArray), seen);
      },
      get() {
        return undefined;
      },
      getPrototypeOf() {
        return null;
      },
      set() {
        return false;
      },
      defineProperty() {
        return false;
      },
      deleteProperty() {
        return false;
      },
    });
    seen.set(target, safeFn);
    return safeFn;
  }

  if (typeof (value as { toJSON?: unknown }).toJSON === 'function' && !Array.isArray(value)) {
    try {
      const json = (value as { toJSON: () => unknown }).toJSON();
      if (json !== value) return createSafeValue(json, seen);
    } catch (_) {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    const safeArray: unknown[] = [];
    seen.set(target, safeArray);
    for (const item of value) {
      safeArray.push(createSafeValue(item, seen));
    }
    return safeArray;
  }

  const safeObj = Object.create(null) as Record<string | symbol, unknown>;
  seen.set(target, safeObj);

  for (const key of Reflect.ownKeys(target)) {
    if (isBlockedContextKey(key)) continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (!descriptor) continue;

    let rawValue: unknown;
    if ('value' in descriptor) {
      rawValue = descriptor.value;
    } else if (descriptor.get) {
      try {
        rawValue = Reflect.get(target, key, target);
      } catch (_) {
        continue;
      }
    } else {
      continue;
    }

    const safeValue = createSafeValue(rawValue, seen);
    if (typeof safeValue === 'undefined') continue;
    Object.defineProperty(safeObj, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      writable: false,
      value: safeValue,
    });
  }

  return safeObj;
}

function readSafeProperty(obj: object, key: string | symbol, receiver?: unknown) {
  if (key === Symbol.iterator && Array.isArray(obj)) return Array.prototype[Symbol.iterator].bind(obj);
  if (typeof key !== 'string' || isBlockedContextKey(key)) return undefined;
  if (Array.isArray(obj) && key === 'length') return obj.length;
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return Reflect.get(obj, key, receiver ?? obj);
  }
  return undefined;
}

function createSafeContext(ctx: ServerBaseContext) {
  return new Proxy(Object.create(null), {
    get(_target, key) {
      if (isBlockedContextKey(key)) return undefined;
      return getContextValue(ctx, key);
    },
    has(_target, key) {
      return typeof key === 'string' && !isBlockedContextKey(key) && hasContextMember(ctx, key);
    },
    ownKeys() {
      const keys = new Set<string>();
      const visit = (node: unknown) => {
        const { props, methods, delegates } = getContextInternals(node);
        for (const key of [...Object.keys(props || {}), ...Object.keys(methods || {})]) {
          if (!isBlockedContextKey(key)) keys.add(key);
        }
        if (Array.isArray(delegates)) {
          delegates.forEach(visit);
        }
        if (!props && !methods && !delegates && node && typeof node === 'object') {
          for (const key of Object.keys(node)) {
            if (!isBlockedContextKey(key)) keys.add(key);
          }
        }
      };
      visit(ctx);
      return Array.from(keys);
    },
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key !== 'string' || isBlockedContextKey(key) || !hasContextMember(ctx, key)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        get: () => getContextValue(ctx, key),
      };
    },
    getPrototypeOf() {
      return null;
    },
  });
}

function getContextValue(ctx: ServerBaseContext, key: string | symbol) {
  if (isBlockedContextKey(key)) return undefined;
  const name = key as string;
  if (!hasContextMember(ctx, name)) return undefined;
  return createSafeValue((ctx as Record<string, unknown>)[name]);
}

function createSandboxEndowments(ctx: ServerBaseContext) {
  const blockedGlobals = Object.fromEntries(BLOCKED_SANDBOX_GLOBALS.map((key) => [key, undefined]));
  const safeConsole = {
    debug: (...args: unknown[]) => console.debug(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
  };

  return {
    ...blockedGlobals,
    ctx: createSafeContext(ctx),
    __get: createSafeValue((varName: string, path?: string) => getAtPath(ctx, varName, path)),
    console: createSafeValue(safeConsole),
  };
}

function skipWhitespace(expression: string, index: number) {
  let i = index;
  while (i < expression.length && /\s/.test(expression[i])) i += 1;
  return i;
}

async function replacePlaceholders(input: string, ctx: any) {
  const single = input.match(/^\{\{\s*(.+)\s*\}\}$/);
  if (single) {
    const val = await evaluate(single[1], ctx);
    return typeof val === 'undefined' ? input : val;
  }
  const regex = /\{\{\s*(.+?)\s*\}\}/g;
  let result = input;
  const matches = [...input.matchAll(regex)];
  for (const [full, inner] of matches) {
    const value = await evaluate(inner, ctx);
    if (typeof value !== 'undefined') {
      const replacement = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
      result = result.replace(full, replacement);
    }
  }
  return result;
}

// 在 SES 沙箱中执行完整的 JS 表达式；在此之前会将 ctx.* 访问改写为 await __get(var, path)
async function evaluate(expr: string, ctx: any) {
  try {
    const raw = expr.trim();

    // 优先处理仅点号路径的聚合：ctx.a.b.c（不支持括号/函数/索引）
    // 顶层变量名仍使用 JS 标识符规则；子路径允许包含 '-'（例如 formValues.roles.a-b）。
    const dotOnly = raw.match(
      /^ctx\.([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\.([a-zA-Z_$][a-zA-Z0-9_$-]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$-]*)*))?$/,
    );
    if (dotOnly) {
      const first = dotOnly[1];
      const rest = dotOnly[2];
      const base = await getContextValue(ctx, first);
      if (!rest) return base;
      // 使用异步版本取值，逐段 await，并保留数组场景下的隐式聚合语义
      const resolved = await asyncGetValuesByPath(base, rest);
      // 当 dot path 含 '-' 时可能与减号运算符存在歧义（例如：ctx.aa.bb-ctx.cc）。
      // 若按 path 解析未取到值，则回退到 JS 表达式解析，尽量保持兼容。
      if (typeof resolved !== 'undefined' || !rest.includes('-')) {
        return resolved;
      }
    }

    const transformed = preprocessExpression(raw);
    ensureTemplateSesLockdown();
    const compartment = new Compartment(createSandboxEndowments(ctx));
    const wrapped = `(async () => { try { return ${transformed}; } catch (e) { return undefined; } })()`;
    return await compartment.evaluate(wrapped);
  } catch (_) {
    return undefined;
  }
}

// __get(varName, pathString?) -> Promise<any>
// 从 ctx 中获取指定变量并按路径取值（支持异步）。
async function getAtPath(ctx: any, varName: string, path?: string) {
  try {
    // base may be Promise; wait once
    let current = await getContextValue(ctx, varName);
    if (!path) return current;
    const norm = String(path || '').replace(/^\./, '');
    const segments = _.toPath(norm);
    for (const seg of segments) {
      if (current == null) return undefined;
      let val = readSafeProperty(Object(current), seg);
      if (val && typeof (val as { then?: unknown }).then === 'function') {
        val = await val;
      }
      current = val;
    }
    return current;
  } catch (_) {
    return undefined;
  }
}

/**
 * 异步版本的 getValuesByPath：
 * - 逐段访问路径，若某段值为 Promise，则 await 后再继续。
 * - 当中途遇到数组时，对数组进行聚合：对每个元素递归解析剩余路径并扁平合并。
 * - 返回规则与原 getValuesByPath 尽量一致：
 *   - 命中数组：返回去除 null 的数组；
 *   - 非数组：返回首个值；
 *   - 全部未命中：返回 defaultValue（默认 undefined）。
 */
async function asyncGetValuesByPath(obj: any, path: string, defaultValue?: any): Promise<any> {
  try {
    // 允许 obj 为 Promise
    let currentValue: any = await obj;
    if (!currentValue) return defaultValue;

    const keys = String(path || '').split('.');
    let result: any[] = [];
    let shouldReturnArray = false;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      // 数组：对每个元素递归解析剩余路径并聚合
      if (Array.isArray(currentValue)) {
        if (key === 'length') {
          currentValue = currentValue.length;
          if (i === keys.length - 1) {
            result.push(currentValue);
          }
          continue;
        }

        shouldReturnArray = true;
        const rest = keys.slice(i).join('.');
        const parts = await Promise.all(
          Array.from(currentValue as unknown[]).map((el) => asyncGetValuesByPath(el, rest, defaultValue)),
        );
        // 将数组或标量统一拍平一层
        for (const p of parts) {
          if (Array.isArray(p)) result.push(...p);
          else if (typeof p !== 'undefined') result.push(p);
        }
        break;
      }

      // 普通对象属性访问，若为 Promise 则等待
      let val = readSafeProperty(Object(currentValue), key);
      if (val && typeof (val as { then?: unknown }).then === 'function') {
        val = await val;
      }
      currentValue = val;

      if (i === keys.length - 1) {
        result.push(currentValue);
      }
    }

    // 过滤 undefined
    result = result.filter((item) => typeof item !== 'undefined');

    if (result.length === 0) return defaultValue;
    if (shouldReturnArray) return result.filter((item) => item !== null);
    return result[0];
  } catch (_) {
    return defaultValue;
  }
}

/**
 * 将表达式中的 ctx 访问改写为内部 __get 调用。
 * 例如：ctx.user.id + 1 => (await __get('user', '.id')) + 1
 *
 * @param expression 原始表达式字符串
 * @returns 改写后的表达式字符串
 */
export function preprocessExpression(expression: string): string {
  let out = '';
  let i = 0;
  const n = expression.length;
  while (i < n) {
    // find next 'ctx.' or 'ctx[' occurrence
    const dotIdx = expression.indexOf('ctx.', i);
    const brkIdx = expression.indexOf('ctx[', i);
    let idx = -1;
    if (dotIdx === -1) idx = brkIdx;
    else if (brkIdx === -1) idx = dotIdx;
    else idx = Math.min(dotIdx, brkIdx);

    if (idx === -1) {
      out += expression.slice(i);
      break;
    }

    // copy preceding text
    out += expression.slice(i, idx);

    let j = idx + 3; // after 'ctx'
    let varName: string | null = null;
    let pathStr = '';

    if (expression[j] === '.') {
      j += 1;
      const varMatch = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(expression.slice(j));
      if (!varMatch) {
        out += 'ctx.'; // keep literal and move on
        i = j;
        continue;
      }
      varName = varMatch[0];
      j += varName.length;
    } else if (expression[j] === '[') {
      // bracket var: ctx['user'] or ctx["user"]
      const m = /^\[("((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\]/.exec(expression.slice(j));
      if (!m) {
        out += 'ctx[';
        i = j;
        continue;
      }
      varName = (m[2] ?? m[3]) as string; // unescaped content
      j += m[0].length;
    } else {
      // not a recognized ctx access
      out += expression.slice(idx, idx + 3);
      i = idx + 3;
      continue;
    }

    // parse rest path: sequence of .ident or [index|"str"|'str']
    while (j < n) {
      if (expression[j] === '.') {
        const m = /^\.[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(expression.slice(j));
        if (!m) break;
        if (expression[skipWhitespace(expression, j + m[0].length)] === '(') break;
        pathStr += m[0];
        j += m[0].length;
      } else if (expression[j] === '[') {
        const m = /^(\[(?:\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\])/.exec(expression.slice(j));
        if (!m) break;
        if (expression[skipWhitespace(expression, j + m[1].length)] === '(') break;
        pathStr += m[1];
        j += m[1].length;
      } else {
        break;
      }
    }

    const argPath = pathStr ? `, ${JSON.stringify(pathStr)}` : '';
    out += `(await __get(${JSON.stringify(varName)}${argPath}))`;
    i = j;
  }
  return out;
}

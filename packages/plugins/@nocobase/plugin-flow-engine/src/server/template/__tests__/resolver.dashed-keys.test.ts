/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, it, expect } from 'vitest';
import { ServerBaseContext } from '../contexts';
import { resolveJsonTemplate } from '../resolver';

describe('server template resolver: dashed keys in dot-only path', () => {
  it('resolves dashed keys in dot-only expressions', async () => {
    const ctx = new ServerBaseContext();
    ctx.defineProperty('formValues', {
      value: {
        roles: {
          'a-b': 123,
        },
      },
    });

    const out = await resolveJsonTemplate('{{ ctx.formValues.roles.a-b }}', ctx as any);
    expect(out).toBe(123);
  });

  it('resolves dashed keys inside template strings', async () => {
    const ctx = new ServerBaseContext();
    ctx.defineProperty('formValues', {
      value: {
        roles: {
          'a-b': 'X',
        },
      },
    });

    const out = await resolveJsonTemplate('prefix {{ ctx.formValues.roles.a-b }} suffix', ctx as any);
    expect(out).toBe('prefix X suffix');
  });

  it('keeps subtraction working (fallback to JS evaluation)', async () => {
    const ctx = new ServerBaseContext();
    ctx.defineProperty('aa', { value: { bb: 10 } });
    ctx.defineProperty('cc', { value: 5 });

    const out = await resolveJsonTemplate('{{ ctx.aa.bb-ctx.cc }}', ctx as any);
    expect(out).toBe(5);
  });

  it('blocks Function-constructor sandbox escapes', async () => {
    const ctx = new ServerBaseContext();
    const out = await resolveJsonTemplate(
      {
        globalFunction: '{{ typeof Function === "undefined" ? "safe" : "bad" }}',
        getConstructor:
          '{{ (() => { try { return __get.constructor("return process")() ? "bad" : "safe"; } catch (e) { return "safe"; } })() }}',
        consoleConstructor:
          '{{ (() => { try { return console.log.constructor("return process")() ? "bad" : "safe"; } catch (e) { return "safe"; } })() }}',
        intrinsicConstructor:
          '{{ (() => { try { return ({}).constructor.constructor("return process")() ? "bad" : "safe"; } catch (e) { return "safe"; } })() }}',
      },
      ctx as any,
    );

    expect(out).toEqual({
      globalFunction: 'safe',
      getConstructor: 'safe',
      consoleConstructor: 'safe',
      intrinsicConstructor: 'safe',
    });
  });

  it('preserves safe array and object expression helpers', async () => {
    const ctx = new ServerBaseContext();
    ctx.defineProperty('arr', { value: [1, 2, 3] });
    ctx.defineProperty('obj', {
      value: {
        items: [
          { ok: true, name: 'a' },
          { ok: false, name: 'b' },
          { ok: true, name: 'c' },
        ],
      },
    });

    const out = await resolveJsonTemplate(
      {
        length: '{{ ctx.arr.length }}',
        mapped: '{{ ctx.arr.map((x) => x * 2).join(",") }}',
        filtered: '{{ ctx.obj.items.filter((item) => item.ok).map((item) => item.name).join("|") }}',
      },
      ctx as any,
    );

    expect(out).toEqual({
      length: 3,
      mapped: '2,4,6',
      filtered: 'a|c',
    });
  });
});

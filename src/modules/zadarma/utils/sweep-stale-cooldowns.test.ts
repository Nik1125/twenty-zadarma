import { describe, expect, it, vi } from 'vitest';

import { sweepStaleCooldowns } from './sweep-stale-cooldowns';

const NOW_ISO = '2026-05-12T13:00:00Z';

describe('sweepStaleCooldowns', () => {
  it('flips every returned Person → IDLE and counts them', async () => {
    const query = vi.fn().mockResolvedValue({
      people: { edges: [{ node: { id: 'a' } }, { node: { id: 'b' } }] },
    });
    const mutation = vi.fn().mockResolvedValue({ updatePerson: { id: 'x' } });
    const client = { query, mutation } as never;

    const res = await sweepStaleCooldowns(client, NOW_ISO);

    expect(res).toEqual({ swept: 2 });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[0][0].updatePerson.__args).toMatchObject({
      id: 'a',
      data: { activeCallStatus: 'IDLE', activeCallCooldownUntil: null },
    });
    expect(mutation.mock.calls[1][0].updatePerson.__args).toMatchObject({
      id: 'b',
    });
  });

  it('issues the query with the supplied ISO timestamp + COOLDOWN filter', async () => {
    const query = vi.fn().mockResolvedValue({ people: { edges: [] } });
    const mutation = vi.fn();
    const client = { query, mutation } as never;

    await sweepStaleCooldowns(client, NOW_ISO);

    const queryArgs = query.mock.calls[0][0].people.__args;
    expect(queryArgs.first).toBe(50);
    expect(queryArgs.filter).toEqual({
      and: [
        { activeCallStatus: { eq: 'COOLDOWN' } },
        { activeCallCooldownUntil: { lt: NOW_ISO } },
      ],
    });
  });

  it('returns swept=0 and skips mutation when no stale rows', async () => {
    const query = vi.fn().mockResolvedValue({ people: { edges: [] } });
    const mutation = vi.fn();
    const client = { query, mutation } as never;

    const res = await sweepStaleCooldowns(client, NOW_ISO);

    expect(res).toEqual({ swept: 0 });
    expect(mutation).not.toHaveBeenCalled();
  });

  it('continues sweeping after individual mutation failures', async () => {
    const query = vi.fn().mockResolvedValue({
      people: { edges: [{ node: { id: 'a' } }, { node: { id: 'b' } }] },
    });
    const mutation = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ updatePerson: { id: 'b' } });
    const client = { query, mutation } as never;

    const res = await sweepStaleCooldowns(client, NOW_ISO);

    expect(res).toEqual({ swept: 1 });
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('returns swept=0 and does not throw when the query itself fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('network down'));
    const mutation = vi.fn();
    const client = { query, mutation } as never;

    const res = await sweepStaleCooldowns(client, NOW_ISO);

    expect(res).toEqual({ swept: 0 });
    expect(mutation).not.toHaveBeenCalled();
  });

  it('uses an auto-generated YYYY-MM-DDTHH:mm:ssZ timestamp when nowIso omitted', async () => {
    const query = vi.fn().mockResolvedValue({ people: { edges: [] } });
    const mutation = vi.fn();
    const client = { query, mutation } as never;

    await sweepStaleCooldowns(client);

    const ltValue =
      query.mock.calls[0][0].people.__args.filter.and[1]
        .activeCallCooldownUntil.lt;
    expect(ltValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { clearCooldownIfUnchanged } from './clear-cooldown-if-unchanged';

const COOLDOWN_ISO = '2026-05-12T10:05:00.000Z';
const PERSON_ID = 'person-uuid-1';

const buildClient = (
  personNode: { activeCallStatus: string | null; activeCallCooldownUntil: string | null } | null,
) => {
  const query = vi.fn().mockResolvedValue({
    people: {
      edges: personNode ? [{ node: personNode }] : [],
    },
  });
  const mutation = vi.fn().mockResolvedValue({ updatePerson: { id: PERSON_ID } });
  return { query, mutation } as never;
};

describe('clearCooldownIfUnchanged', () => {
  it('flips status to IDLE when status + cooldownUntil match', async () => {
    const client = buildClient({
      activeCallStatus: 'COOLDOWN',
      activeCallCooldownUntil: COOLDOWN_ISO,
    });
    const result = await clearCooldownIfUnchanged(client, PERSON_ID, COOLDOWN_ISO);
    expect(result).toEqual({ cleared: true });
    expect((client as never as { mutation: ReturnType<typeof vi.fn> }).mutation).toHaveBeenCalledTimes(1);
    const callArgs = (client as never as { mutation: ReturnType<typeof vi.fn> }).mutation.mock.calls[0][0];
    expect(callArgs.updatePerson.__args.data).toEqual({
      activeCallStatus: 'IDLE',
      activeCallCooldownUntil: null,
    });
  });

  it('returns person-not-found when no Person matches the id', async () => {
    const client = buildClient(null);
    const result = await clearCooldownIfUnchanged(client, PERSON_ID, COOLDOWN_ISO);
    expect(result).toEqual({ cleared: false, reason: 'person-not-found' });
    expect((client as never as { mutation: ReturnType<typeof vi.fn> }).mutation).not.toHaveBeenCalled();
  });

  it('skips when status is no longer COOLDOWN (operator flip / new CALLING)', async () => {
    const client = buildClient({
      activeCallStatus: 'CALLING',
      activeCallCooldownUntil: COOLDOWN_ISO,
    });
    const result = await clearCooldownIfUnchanged(client, PERSON_ID, COOLDOWN_ISO);
    expect(result).toEqual({
      cleared: false,
      reason: 'status-changed',
      currentStatus: 'CALLING',
    });
    expect((client as never as { mutation: ReturnType<typeof vi.fn> }).mutation).not.toHaveBeenCalled();
  });

  it('skips when status is IDLE (manual reset)', async () => {
    const client = buildClient({
      activeCallStatus: 'IDLE',
      activeCallCooldownUntil: null,
    });
    const result = await clearCooldownIfUnchanged(client, PERSON_ID, COOLDOWN_ISO);
    expect(result).toEqual({
      cleared: false,
      reason: 'status-changed',
      currentStatus: 'IDLE',
    });
    expect((client as never as { mutation: ReturnType<typeof vi.fn> }).mutation).not.toHaveBeenCalled();
  });

  it('skips when cooldownUntil was extended by a newer call', async () => {
    const newerCooldownIso = '2026-05-12T10:10:00.000Z';
    const client = buildClient({
      activeCallStatus: 'COOLDOWN',
      activeCallCooldownUntil: newerCooldownIso,
    });
    const result = await clearCooldownIfUnchanged(client, PERSON_ID, COOLDOWN_ISO);
    expect(result).toEqual({
      cleared: false,
      reason: 'cooldown-extended',
      currentCooldownUntil: newerCooldownIso,
    });
    expect((client as never as { mutation: ReturnType<typeof vi.fn> }).mutation).not.toHaveBeenCalled();
  });

  it('skips when cooldownUntil is null (cleared by another path)', async () => {
    const client = buildClient({
      activeCallStatus: 'COOLDOWN',
      activeCallCooldownUntil: null,
    });
    const result = await clearCooldownIfUnchanged(client, PERSON_ID, COOLDOWN_ISO);
    expect(result).toEqual({
      cleared: false,
      reason: 'cooldown-extended',
      currentCooldownUntil: null,
    });
    expect((client as never as { mutation: ReturnType<typeof vi.fn> }).mutation).not.toHaveBeenCalled();
  });
});

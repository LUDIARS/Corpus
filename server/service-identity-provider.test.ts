import { describe, expect, it, vi } from 'vitest';
import { makeServiceIdentityProvider } from './service-identity-provider.ts';
import type { ServiceUserSession } from './auth.ts';

const session: ServiceUserSession = { token: 's'.repeat(43), grant: { projectToken: 'private-scoped-grant', sessionBinding: 'b'.repeat(43),
  projectKey: 'service', expiresAt: new Date(Date.now() + 600_000).toISOString(), user: { id: 'subject', role: 'general', displayName: 'Person', email: null } } };
function fixture() {
  const store = { organizations: vi.fn(async (_token: string) => []), faceConsentStatus: vi.fn(async (_token: string) => []),
    createFaceConsent: vi.fn(async (_token: string, _facility: string, _policy: string) => {}), revokeFaceConsent: vi.fn(async (_token: string, _facility?: string) => {}) };
  return { store, provider: makeServiceIdentityProvider(store) };
}
describe('own identity plugin facade', () => {
  it('resolves only the local opaque credential, not supplied subject/grant fields', async () => {
    const { store, provider } = fixture();
    await provider.organizations(session);
    expect(store.organizations).toHaveBeenCalledOnce();
    expect(store.organizations).toHaveBeenCalledWith(session.token);
    await provider.createFaceConsent(session, 'facility', 'policy');
    expect(store.createFaceConsent).toHaveBeenCalledOnce();
    expect(store.createFaceConsent).toHaveBeenCalledWith(session.token, 'facility', 'policy');
  });
  it('refuses missing local sessions, including delegated and machine actors', async () => {
    const { store, provider } = fixture();
    await expect(provider.organizations(null)).rejects.toThrow('bound local service session');
    await expect(provider.faceConsentStatus(null)).rejects.toThrow();
    await expect(provider.createFaceConsent(null, 'facility', 'policy')).rejects.toThrow();
    await expect(provider.revokeFaceConsent(null)).rejects.toThrow();
    for (const operation of Object.values(store)) expect(operation).not.toHaveBeenCalled();
  });
  it('does not cache or retry a denied/unknown own-identity operation', async () => {
    const { store, provider } = fixture();
    store.organizations.mockRejectedValueOnce(new Error('Unknown authority result'));
    await expect(provider.organizations(session)).rejects.toThrow('Unknown authority result');
    expect(store.organizations).toHaveBeenCalledOnce();
  });
});

/** Plugin facade for Cr-owned, own-subject resources; no global credential escape.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import type { ServiceUserSession } from './auth.ts';
import type { ServiceSessionStore } from './service-session-store.ts';
import type { OwnOrganizationMembership, OwnFaceConsent } from '../lib/cernere/packages/composite/src/service-identity.js';

export interface ServiceIdentityProvider {
  organizations(session: ServiceUserSession | null): Promise<OwnOrganizationMembership[]>;
  faceConsentStatus(session: ServiceUserSession | null): Promise<OwnFaceConsent[]>;
  createFaceConsent(session: ServiceUserSession | null, facilityId: string, policyVersion: string): Promise<void>;
  revokeFaceConsent(session: ServiceUserSession | null, facilityId?: string): Promise<void>;
}
export function makeServiceIdentityProvider(sessions: Pick<ServiceSessionStore, 'organizations' | 'faceConsentStatus' | 'createFaceConsent' | 'revokeFaceConsent'>): ServiceIdentityProvider {
  const token = (session: ServiceUserSession | null): string => {
    if (!session) throw new Error('A bound local service session is required for own identity access');
    return session.token;
  };
  return {
    organizations: async session => sessions.organizations(token(session)),
    faceConsentStatus: async session => sessions.faceConsentStatus(token(session)),
    createFaceConsent: async (session, facilityId, policyVersion) => sessions.createFaceConsent(token(session), facilityId, policyVersion),
    revokeFaceConsent: async (session, facilityId) => sessions.revokeFaceConsent(token(session), facilityId),
  };
}

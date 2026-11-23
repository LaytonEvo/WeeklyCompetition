/**
 * CRM / email-marketing adapter boundary (e.g. Klaviyo or Evolution Golf's
 * CRM). NOT connected. Today the consented audience is exported as CSV from
 * Admin › Marketing.
 *
 * Rules any adapter must follow:
 *  - Only sync customers whose CURRENT marketing consent is true (re-check at
 *    sync time, not at queue time).
 *  - Propagate withdrawals (consent false) as unsubscribes/suppressions.
 *  - Never sync operational-only customers into marketing lists.
 */
export interface CrmContact {
  email: string;
  firstName: string;
  lastName: string;
  consentedAt: Date;
  source: string | null;
  properties: Record<string, string | number | boolean | null>;
}

export interface CrmAdapter {
  id: string;
  upsertConsented(contacts: CrmContact[]): Promise<void>;
  suppress(emails: string[]): Promise<void>;
}

export const CRM_ADAPTERS: Record<string, CrmAdapter> = {};

/** Shapes returned by the Toosh API (server/src). Money values are canonical decimal strings, never floats. */
export type Classification = 'PENDING' | 'TRANSACTION' | 'NOT_TRANSACTION';

export interface Message {
  id: string; evcNumberId: string; sourceDeviceId: string; sender: string; body: string;
  smsTimestamp: string; receivedAt: string; uploadedAt: string;
  simSubscriptionId: number | null; simSlot: number | null; importMethod: 'LIVE' | 'INITIAL_IMPORT' | 'RECOVERY'; partsCount: number;
  parserVersion: string;
  parsed: {
    kind: 'TRANSACTION' | 'BALANCE' | 'UNRECOGNIZED'; direction: 'IN' | 'OUT' | null; amount: string | null; currency: 'USD' | null;
    counterpartyName: string | null; counterpartyPhone: string | null; occurredAt: string | null; balance: string | null;
    providerRef: string | null; autoConfirm: boolean; issues: string[]; reviewReasons?: string[];
  };
  classification: Classification; classificationSource: 'PARSER' | 'MANUAL';
  transaction: null | {
    direction: 'IN' | 'OUT'; amount: string; currency: 'USD'; occurredAt: string; occurredAtSource: 'SMS' | 'RECEIPT_FALLBACK' | 'MANUAL';
    counterpartyName: string | null; counterpartyPhone: string | null; providerRef: string | null;
  };
  balance: null | { amount: string; source: 'PARSER' | 'MANUAL'; effectiveAt: string; eligible: boolean };
  fieldSources: Record<string, string>;
  version: number; updatedAt: string; updatedByDeviceId: string | null; changeSeq: string;
}

export interface Device {
  id: string; role: 'SOURCE' | 'VIEWER'; name: string; platform: 'android' | 'web' | 'ios' | 'other'; model: string | null;
  appVersion: string | null; smsPermission: 'GRANTED' | 'DENIED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  queuePending: number | null; queueFailed: number | null; lastError: string | null;
  createdAt: string; lastSeenAt: string | null; lastUploadAt: string | null; revokedAt: string | null; current: boolean;
}

export interface EvcNumber {
  id: string; msisdn: string; displayName: string | null; verificationStatus: 'UNVERIFIED';
  sourceDeviceId: string | null; simSubscriptionId: number | null; simSlot: number | null; simLabel: string | null; createdAt: string;
}

export interface Me {
  account: { id: string; displayName: string; loginPhone: string; timezone: string; createdAt: string };
  device: Device; evcNumbers: EvcNumber[]; devices: Device[];
}

export interface Balance { evcNumberId: string; messageId: string; amount: string; currency: 'USD'; source: string; effectiveAt: string }

export interface Summary {
  range: { start: string; end: string; timezone: string; period: string };
  incoming: { total: string; count: number }; outgoing: { total: string; count: number };
  pendingCount: number; balances: Balance[]; recent: Message[];
}

export interface MessagePage { items: Message[]; counts: { all: number; in: number; out: number; pending: number; ignored: number }; nextCursor: string | null }
export interface TransactionPage {
  items: Message[]; nextCursor: string | null; range: { start: string; end: string } | null;
  totals: { incoming: string; incomingCount: number; outgoing: string; outgoingCount: number };
}
export interface HistoryEntry {
  action: 'INGEST' | 'CLASSIFY' | 'REPROCESS'; actorDeviceId: string | null; actorDeviceName: string | null;
  fromVersion: number | null; toVersion: number; previous: any; next: any; changedAt: string;
}

export type PeriodChoice = { period: 'today' | 'week' | 'month' | 'all' } | { period: 'custom'; from: string; to: string };

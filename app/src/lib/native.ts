/**
 * Bridge to the native Android layer (android/app/src/main/java/so/toosh/app/TooshNativePlugin.java).
 * SMS capture, the durable upload queue and the secure token store live in native code so they keep working when
 * the app UI is closed. In a browser these features do not exist and `isNativeAndroid` is false.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export type PermissionState = 'GRANTED' | 'DENIED' | 'NOT_ASKED' | 'PERMANENTLY_DENIED';

export interface Sim {
  subscriptionId: number; simSlot: number; carrierName: string | null; displayName: string | null;
  /** Only present when Android exposes it; often unavailable. Used as a hint, never as proof. */
  number: string | null;
}

export interface SimMapping { subscriptionId: number | null; simSlot: number | null; evcNumberId: string; accountId: string }

export interface NativeStatus {
  smsPermission: PermissionState;
  readSmsPermission: PermissionState;
  phoneStatePermission: PermissionState;
  notificationPermission: PermissionState;
  queue: { pending: number; uploading: number; failed: number; unmatched: number; synced: number };
  lastUploadAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  authProblem: boolean;
  online: boolean;
  deviceModel: string;
  androidVersion: string;
  appVersion: string;
  mappings: SimMapping[];
  strictFilter: boolean;
  notifyNew: boolean;
  notifyPending: boolean;
  importDoneAt: string | null;
  /** Android system font size (1 = default). */
  fontScale?: number;
}

export interface LocalMessage {
  localId: string; clientMessageId: string; sender: string; body: string; smsTimestamp: string; receivedAt: string;
  simSubscriptionId: number | null; simSlot: number | null; evcNumberId: string | null; importMethod: string; partsCount: number;
  state: 'PENDING' | 'UPLOADING' | 'FAILED' | 'UNMATCHED' | 'SYNCED'; attempts: number; lastError: string | null; serverMessageId: string | null;
}

export interface TooshNativePlugin {
  getSession(): Promise<{ token: string | null; accountId: string | null }>;
  setSession(options: { token: string | null; accountId: string | null; apiBase: string; deviceId: string | null }): Promise<void>;
  getStatus(): Promise<NativeStatus>;
  requestSmsPermission(): Promise<{ state: PermissionState }>;
  requestReadSmsPermission(): Promise<{ state: PermissionState }>;
  requestPhoneStatePermission(): Promise<{ state: PermissionState }>;
  requestNotificationPermission(): Promise<{ state: PermissionState }>;
  openAppSettings(): Promise<void>;
  listSims(): Promise<{ sims: Sim[] }>;
  setSourceMappings(options: { mappings: SimMapping[]; strictFilter: boolean }): Promise<void>;
  startInitialImport(options: { days: number }): Promise<{ scanned: number; queued: number; duplicates: number }>;
  getLocalMessages(options: { limit: number; unsyncedOnly: boolean }): Promise<{ messages: LocalMessage[] }>;
  assignUnmatched(options: { localIds: string[]; evcNumberId: string }): Promise<{ updated: number }>;
  retryFailed(): Promise<void>;
  syncNow(): Promise<void>;
  setPreferences(options: { notifyNew?: boolean; notifyPending?: boolean; strictFilter?: boolean }): Promise<void>;
  canAuthenticate(): Promise<{ available: boolean }>;
  authenticate(options: { title: string; subtitle: string }): Promise<{ success: boolean; error: string | null }>;
  addListener(event: 'queueChanged', fn: (status: NativeStatus) => void): Promise<PluginListenerHandle>;
}

export const TooshNative = registerPlugin<TooshNativePlugin>('TooshNative');

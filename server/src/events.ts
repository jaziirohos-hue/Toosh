/**
 * Change notifications to an account's other devices. Writes call notifyAccount() inside their transaction;
 * Postgres delivers the NOTIFY only after COMMIT, to every server instance, which forwards it to that account's
 * open event streams. Clients then refetch, so a lost or reordered notification never leaves wrong data on screen.
 */
import pg from 'pg';
import type { Tx } from './db.ts';

type Listener = (payload: { seq: string }) => void;

export class ChangeHub {
  private listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;
  private stopped = false;

  constructor(private connectionString: string) {}

  async start() {
    const connect = async () => {
      if (this.stopped) return;
      const client = new pg.Client({ connectionString: this.connectionString });
      client.on('notification', msg => {
        const [accountId, seq] = String(msg.payload ?? '').split(':');
        this.listeners.get(accountId)?.forEach(fn => fn({ seq: seq ?? '0' }));
      });
      client.on('error', () => { client.end().catch(() => {}); this.client = null; setTimeout(connect, 2000); });
      await client.connect();
      await client.query('LISTEN toosh_changes');
      this.client = client;
    };
    await connect();
  }

  subscribe(accountId: string, fn: Listener): () => void {
    let set = this.listeners.get(accountId);
    if (!set) this.listeners.set(accountId, (set = new Set()));
    set.add(fn);
    return () => { set!.delete(fn); if (!set!.size) this.listeners.delete(accountId); };
  }

  async stop() { this.stopped = true; await this.client?.end().catch(() => {}); }
}

export async function notifyAccount(tx: Tx, accountId: string) {
  await tx.query(`SELECT pg_notify('toosh_changes', $1 || ':' || (SELECT last_value FROM change_seq)::text)`, [accountId]);
}

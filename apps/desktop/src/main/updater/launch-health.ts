import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Notices when a version keeps failing to start. Each launch is counted until
 * River has been running for a while (then it is "healthy"); three unhealthy
 * starts in a row right after an update means something is wrong with that
 * update, so automatic installs pause and the user is told.
 */
export interface HealthRecord {
  version: string;
  /** Launches of this version that never became healthy. */
  starts: number;
  healthy: boolean;
  /** The version that ran before this one, if River was updated. */
  previousVersion: string | null;
}

export const CRASH_LOOP_STARTS = 3;

export class LaunchHealth {
  private record: HealthRecord;
  private readonly file: string;

  constructor(file: string, currentVersion: string) {
    this.file = file;
    const old = this.read();
    if (old && old.version === currentVersion) {
      this.record = old.healthy ? old : { ...old, starts: old.starts + 1 };
    } else {
      this.record = {
        version: currentVersion,
        starts: 1,
        healthy: false,
        previousVersion: old ? old.version : null,
      };
    }
    this.write();
  }

  /** River ran long enough: this version starts fine. */
  markHealthy(): void {
    if (this.record.healthy) return;
    this.record = { ...this.record, starts: 0, healthy: true };
    this.write();
  }

  /** This version (installed by an update) failed to start several times in a row. */
  get crashLoop(): boolean {
    return (
      !this.record.healthy && this.record.previousVersion !== null && this.record.starts >= CRASH_LOOP_STARTS
    );
  }

  get current(): Readonly<HealthRecord> {
    return this.record;
  }

  private read(): HealthRecord | null {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<HealthRecord>;
      if (typeof raw.version !== 'string' || typeof raw.starts !== 'number') return null;
      return {
        version: raw.version,
        starts: Math.max(0, Math.floor(raw.starts)),
        healthy: raw.healthy === true,
        previousVersion: typeof raw.previousVersion === 'string' ? raw.previousVersion : null,
      };
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.record));
      renameSync(tmp, this.file);
    } catch {
      // Health tracking is best effort; it must never stop River from starting.
    }
  }
}

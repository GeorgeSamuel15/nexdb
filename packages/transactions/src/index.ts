import { NexError } from "../../common/src/index.ts";
/** Whole-database exclusive lock: conservative serializable transactions. */
export class Gate {
  private owner: object | null = null;
  private queue: {
    owner: object;
    resolve: () => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  async acquire(owner: object) {
    if (this.owner === owner) return;
    if (!this.owner) {
      this.owner = owner;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const item = {
        owner,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.queue = this.queue.filter((i) => i !== item);
          reject(new NexError("LOCK_TIMEOUT", "Database busy"));
        }, 5000),
      };
      this.queue.push(item);
    });
  }
  release(owner: object) {
    if (this.owner !== owner) return;
    const next = this.queue.shift();
    this.owner = next?.owner ?? null;
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    }
  }
}

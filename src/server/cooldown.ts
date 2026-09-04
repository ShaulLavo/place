// Server-authoritative placement cooldown, keyed by user id.

export class Cooldown {
  private readonly until = new Map<string, number>()

  constructor(public cooldownMs: number) {}

  /** Time (ms epoch) the user may place next. 0 if now. */
  nextAllowed(user: string): number {
    return this.until.get(user) ?? 0
  }

  /** Try to consume a placement. Returns the new cooldown deadline, or null if still cooling. */
  tryPlace(user: string, now = Date.now()): number | null {
    const next = this.until.get(user) ?? 0
    if (now < next) return null
    if (this.cooldownMs <= 0) return 0
    const deadline = now + this.cooldownMs
    this.until.set(user, deadline)
    return deadline
  }

  /** Drop expired entries. Call occasionally. */
  sweep(now = Date.now()): void {
    for (const [k, v] of this.until) if (v <= now) this.until.delete(k)
  }
}

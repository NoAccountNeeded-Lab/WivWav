export type JobHandler = (payload: unknown, correlationId: string) => Promise<unknown>

/** Job-handler registry keyed by queue name (#952) — one entry per phase-1 job type. */
export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(queueName: string, handler: JobHandler): void {
    this.handlers.set(queueName, handler)
  }

  get(queueName: string): JobHandler | undefined {
    return this.handlers.get(queueName)
  }
}

import { Prisma, type PrismaClient } from '../generated/prisma/index.js'

export const SCHEDULE_INTENT_KEY_PREFIX = 'ops.schedule.'
export const SOURCE_CONTROL_AUDIT_KEY_PREFIX = 'ops.source-control.'

export type ScheduleIntent = {
  enabled: boolean
  pattern?: string | null
  tz?: string | null
  reason?: string | null
  updatedBy?: string | null
  updatedAt: string
}

export type SourceControlAuditEntry = {
  action: 'disable' | 'enable'
  status: 'disabled' | 'active'
  reason?: string | null
  updatedBy?: string | null
  updatedAt: string
}

function scheduleIntentKey(scheduleId: string): string {
  return `${SCHEDULE_INTENT_KEY_PREFIX}${scheduleId}`
}

function sourceControlAuditKey(sourceId: string): string {
  return `${SOURCE_CONTROL_AUDIT_KEY_PREFIX}${sourceId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseScheduleIntent(value: unknown): ScheduleIntent | null {
  if (!isRecord(value) || typeof value['enabled'] !== 'boolean' || typeof value['updatedAt'] !== 'string') {
    return null
  }

  return {
    enabled: value['enabled'],
    pattern: typeof value['pattern'] === 'string' ? value['pattern'] : null,
    tz: typeof value['tz'] === 'string' ? value['tz'] : null,
    reason: typeof value['reason'] === 'string' ? value['reason'] : null,
    updatedBy: typeof value['updatedBy'] === 'string' ? value['updatedBy'] : null,
    updatedAt: value['updatedAt'],
  }
}

export async function readCurrentScheduleIntents(
  db: PrismaClient,
): Promise<Map<string, ScheduleIntent>> {
  const rows = await db.configEntry.findMany({
    where: { key: { startsWith: SCHEDULE_INTENT_KEY_PREFIX } },
    orderBy: [{ key: 'asc' }, { createdAt: 'desc' }],
    select: { key: true, value: true },
  })

  const intents = new Map<string, ScheduleIntent>()
  for (const row of rows) {
    const scheduleId = row.key.slice(SCHEDULE_INTENT_KEY_PREFIX.length)
    if (scheduleId.length === 0 || intents.has(scheduleId)) continue
    const parsed = parseScheduleIntent(row.value)
    if (parsed !== null) intents.set(scheduleId, parsed)
  }
  return intents
}

export async function appendScheduleIntent(
  db: PrismaClient,
  scheduleId: string,
  intent: Omit<ScheduleIntent, 'updatedAt'> & { updatedAt?: string },
): Promise<void> {
  const value: ScheduleIntent = {
    enabled: intent.enabled,
    pattern: intent.pattern ?? null,
    tz: intent.tz ?? null,
    reason: intent.reason ?? null,
    updatedBy: intent.updatedBy ?? null,
    updatedAt: intent.updatedAt ?? new Date().toISOString(),
  }

  await db.configEntry.create({
    data: {
      key: scheduleIntentKey(scheduleId),
      type: 'json',
      value: value as unknown as Prisma.InputJsonValue,
      description: 'Authoritative operator intent for a repeatable schedule',
      createdBy: intent.updatedBy ?? null,
    },
  })
}

export async function appendSourceControlAuditEntry(
  db: PrismaClient,
  sourceId: string,
  entry: Omit<SourceControlAuditEntry, 'updatedAt'> & { updatedAt?: string },
): Promise<void> {
  const value: SourceControlAuditEntry = {
    action: entry.action,
    status: entry.status,
    reason: entry.reason ?? null,
    updatedBy: entry.updatedBy ?? null,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  }

  await db.configEntry.create({
    data: {
      key: sourceControlAuditKey(sourceId),
      type: 'json',
      value: value as unknown as Prisma.InputJsonValue,
      description: 'Audit trail for authenticated source enable/disable actions',
      createdBy: entry.updatedBy ?? null,
    },
  })
}

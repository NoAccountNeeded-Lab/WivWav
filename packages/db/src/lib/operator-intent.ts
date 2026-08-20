import { Prisma, type PrismaClient } from '../generated/prisma/index.js'

export const SCHEDULE_INTENT_KEY_PREFIX = 'ops.schedule.'
export const SOURCE_CONTROL_AUDIT_KEY_PREFIX = 'ops.source-control.'
export const PRIVATE_SELLER_DELETION_AUDIT_KEY_PREFIX = 'ops.private-seller-deletion.'

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

/**
 * #817 audit trail for the private-seller retention/deletion lifecycle.
 * One append-only row per attempt — both the scheduled sweep
 * (`action: 'automated-retention'`) and an operator's explicit deletion
 * request (`action: 'operator-request'`) write through the same function,
 * so a listing's full history (including failures the next sweep retried)
 * is queryable by `listingId` alone.
 */
export type PrivateSellerDeletionAuditEntry = {
  listingId: string
  action: 'automated-retention' | 'operator-request'
  outcome: 'applied' | 'skipped-already-applied' | 'failed'
  fieldsCleared: string[]
  reason?: string | null
  requestedBy?: string | null
  errorMessage?: string | null
  updatedAt: string
}

function scheduleIntentKey(scheduleId: string): string {
  return `${SCHEDULE_INTENT_KEY_PREFIX}${scheduleId}`
}

function sourceControlAuditKey(sourceId: string): string {
  return `${SOURCE_CONTROL_AUDIT_KEY_PREFIX}${sourceId}`
}

function privateSellerDeletionAuditKey(listingId: string): string {
  return `${PRIVATE_SELLER_DELETION_AUDIT_KEY_PREFIX}${listingId}`
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

function parsePrivateSellerDeletionAuditEntry(
  listingId: string,
  value: unknown,
): PrivateSellerDeletionAuditEntry | null {
  if (
    !isRecord(value) ||
    typeof value['action'] !== 'string' ||
    typeof value['outcome'] !== 'string' ||
    typeof value['updatedAt'] !== 'string' ||
    !Array.isArray(value['fieldsCleared'])
  ) {
    return null
  }

  return {
    listingId,
    action: value['action'] as PrivateSellerDeletionAuditEntry['action'],
    outcome: value['outcome'] as PrivateSellerDeletionAuditEntry['outcome'],
    fieldsCleared: value['fieldsCleared'].filter((field): field is string => typeof field === 'string'),
    reason: typeof value['reason'] === 'string' ? value['reason'] : null,
    requestedBy: typeof value['requestedBy'] === 'string' ? value['requestedBy'] : null,
    errorMessage: typeof value['errorMessage'] === 'string' ? value['errorMessage'] : null,
    updatedAt: value['updatedAt'],
  }
}

export async function appendPrivateSellerDeletionAuditEntry(
  db: PrismaClient,
  listingId: string,
  entry: Omit<PrivateSellerDeletionAuditEntry, 'listingId' | 'updatedAt'> & { updatedAt?: string },
): Promise<void> {
  const value: PrivateSellerDeletionAuditEntry = {
    listingId,
    action: entry.action,
    outcome: entry.outcome,
    fieldsCleared: entry.fieldsCleared,
    reason: entry.reason ?? null,
    requestedBy: entry.requestedBy ?? null,
    errorMessage: entry.errorMessage ?? null,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  }

  await db.configEntry.create({
    data: {
      key: privateSellerDeletionAuditKey(listingId),
      type: 'json',
      value: value as unknown as Prisma.InputJsonValue,
      description: 'Audit trail for private-seller retention/deletion lifecycle actions',
      createdBy: entry.requestedBy ?? null,
    },
  })
}

/** Full history for one listing, newest first — evidence for the operator deletion-request workflow. */
export async function listPrivateSellerDeletionAuditEntries(
  db: PrismaClient,
  listingId: string,
): Promise<PrivateSellerDeletionAuditEntry[]> {
  const rows = await db.configEntry.findMany({
    where: { key: privateSellerDeletionAuditKey(listingId) },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  })

  const entries: PrivateSellerDeletionAuditEntry[] = []
  for (const row of rows) {
    const parsed = parsePrivateSellerDeletionAuditEntry(listingId, row.value)
    if (parsed !== null) entries.push(parsed)
  }
  return entries
}

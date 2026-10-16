/**
 * Atomically removes a job only if it is currently queued (waiting, paused,
 * delayed or prioritized) and unlocked. BullMQ's own `Job#remove` checks the
 * lock only, so a job that completed (or whose lock expired while active)
 * between a state read and the removal would be deleted. Doing the membership
 * check and the deletion in one script closes both races.
 *
 * ARGV: prefix (`bull:<queue>:`), job id, job-scheduler key.
 * Returns `{ code, state }`: 1 removed, 0 job missing, -1 locked,
 * -2 not queued (state describes where it is), -8 current job-scheduler iteration.
 * Mirrors the key cleanup of BullMQ's removeJobWithChildren for jobs without
 * children (this codebase does not use flows).
 */
export const REMOVE_QUEUED_SCRIPT = `
local rcall = redis.call
local prefix, jobId, repeatKey = ARGV[1], ARGV[2], ARGV[3]
local jobKey = prefix .. jobId
if rcall('EXISTS', jobKey) == 0 then return {0, ''} end

local rjk = rcall('HGET', jobKey, 'rjk')
if rjk then
  local prev = rcall('ZSCORE', repeatKey, rjk)
  if prev and jobId == 'repeat:' .. rjk .. ':' .. prev then return {-8, 'scheduled'} end
end
if rcall('EXISTS', jobKey .. ':lock') == 1 then return {-1, 'active'} end

local state
if rcall('ZREM', prefix .. 'delayed', jobId) == 1 then state = 'delayed'
elseif rcall('ZREM', prefix .. 'prioritized', jobId) == 1 then state = 'prioritized'
elseif rcall('LREM', prefix .. 'wait', 1, jobId) == 1 then state = 'wait'
elseif rcall('LREM', prefix .. 'paused', 1, jobId) == 1 then state = 'paused'
else
  if rcall('ZSCORE', prefix .. 'completed', jobId) then return {-2, 'completed'} end
  if rcall('ZSCORE', prefix .. 'failed', jobId) then return {-2, 'failed'} end
  if rcall('LPOS', prefix .. 'active', jobId) then return {-2, 'active'} end
  return {-2, 'unknown'}
end

local deid = rcall('HGET', jobKey, 'deid')
if deid and rcall('GET', prefix .. 'de:' .. deid) == jobId then
  rcall('DEL', prefix .. 'de:' .. deid, prefix .. 'dn:' .. deid)
end
rcall('DEL', jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
  jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
local maxEvents = tonumber(rcall('HGET', prefix .. 'meta', 'opts.maxLenEvents')) or 10000
rcall('XADD', prefix .. 'events', 'MAXLEN', '~', maxEvents, '*', 'event', 'removed',
  'jobId', jobId, 'prev', state)
return {1, state}
`

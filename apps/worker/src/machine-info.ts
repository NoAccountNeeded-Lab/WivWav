import { availableParallelism, cpus, hostname, platform, release, totalmem } from 'node:os'
import { readFileSync } from 'node:fs'
import type { WorkerMachineInfo } from '@wivwav/types/worker-protocol'

interface WorkerPackageJson {
  version?: unknown
}

const workerPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as WorkerPackageJson

const appVersion = typeof workerPackage.version === 'string' ? workerPackage.version : 'unknown'

/** Collect non-secret host/runtime details to help operators diagnose worker capacity. */
export function collectWorkerMachineInfo(): WorkerMachineInfo {
  const cpuModel = cpus()[0]?.model
  return {
    hostname: hostname(),
    platform: platform(),
    osRelease: release(),
    arch: process.arch,
    cpuModel: cpuModel && cpuModel.length > 0 ? cpuModel : 'Unknown CPU',
    cpuCount: availableParallelism(),
    totalMemBytes: totalmem(),
    nodeVersion: process.version,
    appVersion,
  }
}

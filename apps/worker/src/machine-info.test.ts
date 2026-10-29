import * as os from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectWorkerMachineInfo } from './machine-info.js'

vi.mock('node:os', () => ({
  availableParallelism: vi.fn(),
  cpus: vi.fn(),
  hostname: vi.fn(),
  platform: vi.fn(),
  release: vi.fn(),
  totalmem: vi.fn(),
}))

describe('collectWorkerMachineInfo', () => {
  beforeEach(() => {
    vi.mocked(os.availableParallelism).mockReturnValue(6)
    vi.mocked(os.cpus).mockReturnValue([
      {
        model: 'Test CPU', speed: 2400,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      },
    ])
    vi.mocked(os.hostname).mockReturnValue('crawler-laptop')
    vi.mocked(os.platform).mockReturnValue('linux')
    vi.mocked(os.release).mockReturnValue('6.8.0-test')
    vi.mocked(os.totalmem).mockReturnValue(16_000_000_000)
  })

  it('should populate host and runtime metadata', () => {
    expect(collectWorkerMachineInfo()).toEqual({
      hostname: 'crawler-laptop',
      platform: 'linux',
      osRelease: '6.8.0-test',
      arch: process.arch,
      cpuModel: 'Test CPU',
      cpuCount: 6,
      totalMemBytes: 16_000_000_000,
      nodeVersion: process.version,
      appVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    })
  })

  it('should report a fallback CPU model if the host exposes no CPU rows', () => {
    vi.mocked(os.cpus).mockReturnValue([])

    expect(collectWorkerMachineInfo().cpuModel).toBe('Unknown CPU')
  })
})

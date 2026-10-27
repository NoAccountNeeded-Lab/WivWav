import { OPERATOR_SETTINGS, type OperatorSettingKey } from '@wivwav/types/operator-settings'
import type { WivWavLogger } from '@wivwav/logger'

/** Gateway values are validated by the API; outages and local gateways use the registry default. */
export async function readWorkerSetting(
  gateway: { getOperatorSetting?: (key: OperatorSettingKey) => Promise<number> },
  key: OperatorSettingKey,
  logger?: Pick<WivWavLogger, 'warn'>,
): Promise<number> {
  try {
    return await gateway.getOperatorSetting?.(key) ?? OPERATOR_SETTINGS[key].defaultValue
  } catch (err) {
    logger?.warn({ key, err }, 'Operator setting unavailable; using registry default')
    return OPERATOR_SETTINGS[key].defaultValue
  }
}

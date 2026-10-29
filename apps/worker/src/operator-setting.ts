import { OPERATOR_SETTINGS, type OperatorSettingKey, type OperatorSettingValue } from '@wivwav/types/operator-settings'
import type { WivWavLogger } from '@wivwav/logger'

/** Gateway values are validated by the API; outages and local gateways use the registry default. */
export async function readWorkerSetting<K extends OperatorSettingKey>(
  gateway: { getOperatorSetting?: <T extends OperatorSettingKey>(key: T) => Promise<OperatorSettingValue<T>> },
  key: K,
  logger?: Pick<WivWavLogger, 'warn'>,
): Promise<OperatorSettingValue<K>> {
  try {
    return (await gateway.getOperatorSetting?.(key) ?? OPERATOR_SETTINGS[key].defaultValue) as OperatorSettingValue<K>
  } catch (err) {
    logger?.warn({ key, err }, 'Operator setting unavailable; using registry default')
    return OPERATOR_SETTINGS[key].defaultValue
  }
}

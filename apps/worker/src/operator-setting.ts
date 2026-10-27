import { OPERATOR_SETTINGS, type OperatorSettingKey } from '@wivwav/types/operator-settings'

/** Gateway values are already validated by the API. The fallback supports local/mock gateways. */
export async function readWorkerSetting(
  gateway: { getOperatorSetting?: (key: OperatorSettingKey) => Promise<number> },
  key: OperatorSettingKey,
): Promise<number> {
  return await gateway.getOperatorSetting?.(key) ?? OPERATOR_SETTINGS[key].defaultValue
}

export interface BarDatum {
  value: string
  count: number
}

export interface FacetsData {
  shoppingFiltersReady: boolean
  cityBreakdown: BarDatum[]
  transmissionBreakdown: BarDatum[]
  wheelchairCapacityBreakdown: BarDatum[]
  conversionStatusBreakdown: BarDatum[]
  makeBreakdown: BarDatum[]
  modelBreakdown: BarDatum[]
  trimBreakdown: BarDatum[]
  conditionBreakdown: BarDatum[]
  conversionBreakdown: BarDatum[]
  colorBreakdown: BarDatum[]
  stateBreakdown: BarDatum[]
  sellerTypeBreakdown: BarDatum[]
  fuelTypeBreakdown: BarDatum[]
  conversionBrandBreakdown: BarDatum[]
  wavFeatures: {
    hasLift: number
    handControls: number
    rampTypes: BarDatum[]
  }
}

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toBars(value: unknown): BarDatum[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.value !== 'string') return []
    return [{ value: item.value, count: toCount(item.count) }]
  })
}

export function normalizeFacetsData(raw: unknown): FacetsData {
  const source = isRecord(raw) ? raw : {}
  const wavFeatures = isRecord(source.wavFeatures) ? source.wavFeatures : {}
  const wavFeatureCounts = isRecord(source.wavFeatureCounts) ? source.wavFeatureCounts : {}

  return {
    shoppingFiltersReady: source.shoppingFiltersReady === true,
    cityBreakdown: toBars(source.cityBreakdown),
    transmissionBreakdown: toBars(source.transmissionBreakdown),
    wheelchairCapacityBreakdown: toBars(source.wheelchairCapacityBreakdown),
    conversionStatusBreakdown: toBars(source.conversionStatusBreakdown),
    makeBreakdown: toBars(source.makeBreakdown),
    modelBreakdown: toBars(source.modelBreakdown),
    trimBreakdown: toBars(source.trimBreakdown),
    conditionBreakdown: toBars(source.conditionBreakdown),
    conversionBreakdown: toBars(source.conversionBreakdown),
    colorBreakdown: toBars(source.colorBreakdown),
    stateBreakdown: toBars(source.stateBreakdown),
    sellerTypeBreakdown: toBars(source.sellerTypeBreakdown),
    fuelTypeBreakdown: toBars(source.fuelTypeBreakdown),
    conversionBrandBreakdown: toBars(source.conversionBrandBreakdown),
    wavFeatures: {
      hasLift: toCount(wavFeatures.hasLift ?? wavFeatureCounts.has_lift),
      handControls: toCount(wavFeatures.handControls ?? wavFeatureCounts.hand_controls),
      rampTypes: toBars(wavFeatures.rampTypes ?? source.rampTypeBreakdown),
    },
  }
}

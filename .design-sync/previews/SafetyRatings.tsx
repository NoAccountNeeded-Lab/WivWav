import { SafetyRatings } from '@wivwav/web'

const fullRating = {
  id: 'sr1',
  overallRating: 5,
  frontCrashRating: 5,
  sideCrashRating: 4,
  rolloverRating: 4,
  rolloverRatingText: null,
  description: 'NHTSA 5-Star Safety Rating',
  refreshedAt: '2026-06-15',
}

const partialRating = {
  id: 'sr2',
  overallRating: 4,
  frontCrashRating: null,
  sideCrashRating: 3,
  rolloverRating: null,
  rolloverRatingText: 'Not Rated',
  description: null,
  refreshedAt: '2026-05-02',
}

export function FiveStarOverall() {
  return <SafetyRatings rating={fullRating} />
}

export function PartialRatingData() {
  return <SafetyRatings rating={partialRating} />
}

export function isListingNewSinceLastVisit(
  listedAt: string,
  lastVisit: string | null | undefined,
): boolean {
  if (lastVisit == null) return false

  const listedDate = new Date(listedAt)
  const lastVisitDate = new Date(lastVisit)

  if (isNaN(listedDate.getTime()) || isNaN(lastVisitDate.getTime())) return false

  return listedDate > lastVisitDate
}

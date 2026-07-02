import { ListingsResults } from '../filters/page'

interface ResultsPageProps {
  searchParams: Promise<Record<string, string>>
}

export default function ResultsPage({ searchParams }: ResultsPageProps) {
  return (
    <ListingsResults
      searchParams={searchParams}
      resultsPath="/results"
      personalized
    />
  )
}

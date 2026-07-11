import { ListingsResults } from '../filters/page'

interface ResultsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string>>
}

export default async function ResultsPage({ params, searchParams }: ResultsPageProps) {
  const { locale } = await params
  return (
    <ListingsResults
      searchParams={searchParams}
      locale={locale}
      resultsPath={`/${locale}/results`}
      personalized
    />
  )
}

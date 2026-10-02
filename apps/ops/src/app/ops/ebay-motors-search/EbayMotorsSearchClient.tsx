'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import styles from '../ops.module.css'

interface SearchResultItem {
  itemId: string
  title: string
  price: string | null
  condition: string | null
  itemWebUrl: string | null
  categoryPath: string | null
  imageUrl: string | null
  location: string | null
}

interface SearchResponse {
  total: number
  environment: 'production' | 'sandbox'
  items: SearchResultItem[]
}

interface ItemDetail {
  itemId: string
  title: string
  itemWebUrl: string | null
  location: string | null
  aspects: { name: string; value: string }[]
}

interface ApiError {
  code: string
  message: string
}

const DEFAULT_CATEGORY_ID = '6001'
const DEFAULT_LIMIT = 20

export function EbayMotorsSearchClient() {
  const [q, setQ] = useState('wheelchair van')
  const [categoryIds, setCategoryIds] = useState(DEFAULT_CATEGORY_ID)
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [detailsByItemId, setDetailsByItemId] = useState<Record<string, ItemDetail>>({})
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  async function runSearch() {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q: q.trim(), categoryIds: categoryIds.trim(), limit: String(limit) })
      const res = await fetch(`/api/ebay-motors-test/search?${params}`, { cache: 'no-store' })
      const body = (await res.json()) as { data?: SearchResponse; error?: ApiError }
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? `Request failed (${res.status})`)
        setResult(null)
        return
      }
      setResult(body.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function toggleDetails(itemId: string) {
    if (expandedItemId === itemId) {
      setExpandedItemId(null)
      return
    }
    setExpandedItemId(itemId)
    if (detailsByItemId[itemId]) return

    setDetailLoadingId(itemId)
    setDetailError(null)
    try {
      const res = await fetch(`/api/ebay-motors-test/item?itemId=${encodeURIComponent(itemId)}`, {
        cache: 'no-store',
      })
      const body = (await res.json()) as { data?: ItemDetail; error?: ApiError }
      if (!res.ok || !body.data) {
        setDetailError(body.error?.message ?? `Request failed (${res.status})`)
        return
      }
      setDetailsByItemId((prev) => ({ ...prev, [itemId]: body.data as ItemDetail }))
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setDetailLoadingId(null)
    }
  }

  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.container}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.heading}>eBay Motors keyword tester</h1>
            <p className={styles.pageIntro}>
              Try different keywords and category IDs against the live Browse API search endpoint to judge
              recall and precision for WAV listings. Read-only — this never touches the production{' '}
              <code className={styles.inlineCode}>ebay-motors</code> source&apos;s own keyword list or scrape
              schedule.
            </p>
          </div>
          <Link href="/ops/sources" className={styles.backLink}>← Source health</Link>
        </div>

        <form
          className={styles.formPanel}
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch()
          }}
        >
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="ebay-q">Keyword(s)</label>
              <input
                id="ebay-q"
                className={styles.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="wheelchair van"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="ebay-category">Category ID</label>
              <input
                id="ebay-category"
                className={styles.input}
                value={categoryIds}
                onChange={(e) => setCategoryIds(e.target.value)}
                placeholder="6001"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="ebay-limit">Limit</label>
              <input
                id="ebay-limit"
                className={styles.input}
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(Number.parseInt(e.target.value, 10) || DEFAULT_LIMIT)}
              />
            </div>
          </div>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && <p className={styles.error}>{error}</p>}

        {result && (
          <>
            <p className={styles.refreshMeta}>
              {result.total.toLocaleString()} total match(es) on eBay ·{' '}
              <span className={styles.badge} data-variant={result.environment === 'production' ? 'success' : 'warning'}>
                {result.environment}
              </span>
              {' '}· showing {result.items.length}
            </p>

            {result.items.length === 0 ? (
              <p className={styles.empty}>No results for this keyword/category combination.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Category path</th>
                      <th>Price</th>
                      <th>Condition</th>
                      <th>Location</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <Fragment key={item.itemId}>
                        <tr>
                          <td>
                            {item.itemWebUrl ? (
                              <a href={item.itemWebUrl} target="_blank" rel="noreferrer">{item.title}</a>
                            ) : (
                              item.title
                            )}
                          </td>
                          <td className={styles.muted}>{item.categoryPath ?? '—'}</td>
                          <td className={styles.num}>{item.price ?? '—'}</td>
                          <td>{item.condition ?? '—'}</td>
                          <td className={styles.muted}>{item.location ?? '—'}</td>
                          <td>
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnGhost}`}
                              onClick={() => void toggleDetails(item.itemId)}
                            >
                              {expandedItemId === item.itemId ? 'Hide' : 'Aspects'}
                            </button>
                          </td>
                        </tr>
                        {expandedItemId === item.itemId && (
                          <tr className={styles.expandedRow}>
                            <td colSpan={6}>
                              {detailLoadingId === item.itemId && <p className={styles.muted}>Loading…</p>}
                              {detailError && detailLoadingId !== item.itemId && (
                                <p className={styles.error}>{detailError}</p>
                              )}
                              {detailsByItemId[item.itemId] && (
                                <pre className={styles.miniCode}>
                                  {JSON.stringify(detailsByItemId[item.itemId]?.aspects, null, 2)}
                                </pre>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader section={<Link href="/ops">Ops</Link>} />
      {children}
    </>
  )
}

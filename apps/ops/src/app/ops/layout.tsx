import { OpsHeader } from '@/components/OpsHeader'

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OpsHeader />
      {children}
    </>
  )
}

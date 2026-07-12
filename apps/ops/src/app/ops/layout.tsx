import { OpsShell } from '@/components/OpsShell'
import { OpsNav } from '@/components/OpsNav/OpsNav'

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsShell nav={<OpsNav />}>{children}</OpsShell>
}

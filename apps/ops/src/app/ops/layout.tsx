import { OpsShell } from '@/components/OpsShell'
import { OpsNav } from '@/components/OpsNav/OpsNav'
import { NavItemInterceptorProvider } from '@/components/OpsNav/nav-item-interceptor'

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavItemInterceptorProvider>
      <OpsShell nav={<OpsNav />}>{children}</OpsShell>
    </NavItemInterceptorProvider>
  )
}

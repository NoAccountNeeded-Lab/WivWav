import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'WivWav Ops',
  description: 'WivWav internal operations panel',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* WCAG 2.4.1 — skip navigation link, visible only when focused */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}

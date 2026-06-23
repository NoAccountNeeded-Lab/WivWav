import type { Metadata } from 'next'
import {
  DM_Mono,
  DM_Sans,
  Fira_Code,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Lora,
  Nunito,
  Rajdhani,
  Roboto,
  Roboto_Mono,
  Share_Tech_Mono,
  Space_Grotesk,
  Space_Mono,
  Source_Code_Pro,
  VT323,
} from 'next/font/google'
import './globals.css'

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Each theme reads --font (mono) and --font-ui (sans) from themes.css.
// These next/font instances set CSS custom properties on <html> so theme rules
// can reference them with var(--font-<name>).

const jetbrainsMono  = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono',  display: 'swap' })
const inter          = Inter(          { subsets: ['latin'], variable: '--font-inter',           display: 'swap' })
const rajdhani       = Rajdhani(       { subsets: ['latin'], variable: '--font-rajdhani',        display: 'swap', weight: ['400', '500', '600', '700'] })
const sourceCodePro  = Source_Code_Pro({ subsets: ['latin'], variable: '--font-source-code-pro', display: 'swap' })
const spaceMono      = Space_Mono(     { subsets: ['latin'], variable: '--font-space-mono',      display: 'swap', weight: ['400', '700'] })
const spaceGrotesk   = Space_Grotesk(  { subsets: ['latin'], variable: '--font-space-grotesk',   display: 'swap' })
const ibmPlexMono    = IBM_Plex_Mono(  { subsets: ['latin'], variable: '--font-ibm-plex-mono',   display: 'swap', weight: ['400', '500', '600', '700'] })
const ibmPlexSans    = IBM_Plex_Sans(  { subsets: ['latin'], variable: '--font-ibm-plex-sans',   display: 'swap', weight: ['400', '500', '600', '700'] })
const firaCode       = Fira_Code(      { subsets: ['latin'], variable: '--font-fira-code',       display: 'swap' })
const dmSans         = DM_Sans(        { subsets: ['latin'], variable: '--font-dm-sans',         display: 'swap' })
const nunito         = Nunito(         { subsets: ['latin'], variable: '--font-nunito',          display: 'swap' })
const dmMono         = DM_Mono(        { subsets: ['latin'], variable: '--font-dm-mono',         display: 'swap', weight: ['400', '500'] })
const lora           = Lora(           { subsets: ['latin'], variable: '--font-lora',            display: 'swap' })
const shareTechMono  = Share_Tech_Mono({ subsets: ['latin'], variable: '--font-share-tech-mono', display: 'swap', weight: ['400'] })
const vt323          = VT323(          { subsets: ['latin'], variable: '--font-vt323',           display: 'swap', weight: ['400'] })
const robotoMono     = Roboto_Mono(    { subsets: ['latin'], variable: '--font-roboto-mono',     display: 'swap' })
const roboto         = Roboto(         { subsets: ['latin'], variable: '--font-roboto',          display: 'swap', weight: ['400', '500', '700'] })

const allFonts = [
  jetbrainsMono, inter, rajdhani, sourceCodePro, spaceMono, spaceGrotesk,
  ibmPlexMono, ibmPlexSans, firaCode, dmSans, nunito, dmMono, lora,
  shareTechMono, vt323, robotoMono, roboto,
].map(f => f.variable).join(' ')

export const metadata: Metadata = {
  title: 'WivWav Ops',
  description: 'WivWav internal operations panel',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="terminal" className={allFonts}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}

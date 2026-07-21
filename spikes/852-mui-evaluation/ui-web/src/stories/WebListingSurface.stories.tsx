import type { Meta, StoryObj } from '@storybook/react-vite'
import { WebListingSurface } from './WebListingSurface'
import type { SimilarListing } from './WebListingSurface'

// SPIKE PROTOTYPE for issue #852.
const sampleRows: SimilarListing[] = [
  { id: '1', year: 2020, make: 'Toyota', model: 'Sienna', priceCents: 2895000, distanceMiles: 4.2 },
  { id: '2', year: 2019, make: 'Honda', model: 'Odyssey', priceCents: 2650000, distanceMiles: 9.8 },
  { id: '3', year: 2021, make: 'Chrysler', model: 'Pacifica', priceCents: 3120000, distanceMiles: 12.1 },
]

const meta: Meta<typeof WebListingSurface> = {
  title: 'apps-web/Listing detail — similar listings',
  component: WebListingSurface,
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof WebListingSurface>

export const Loading: Story = { args: { state: 'loading' } }
export const ErrorState: Story = { args: { state: 'error' } }
export const Empty: Story = { args: { state: 'empty' } }
export const Loaded: Story = { args: { state: 'loaded', rows: sampleRows } }

export const LoadedNarrow: Story = {
  args: { state: 'loaded', rows: sampleRows },
  parameters: { viewport: { defaultViewport: 'narrow' } },
}
export const LoadedWide: Story = {
  args: { state: 'loaded', rows: sampleRows },
  parameters: { viewport: { defaultViewport: 'wide' } },
}

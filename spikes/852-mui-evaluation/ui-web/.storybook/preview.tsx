import type { Preview } from '@storybook/react-vite'
import * as React from 'react'
import { UiWebProvider } from '../src/Provider'

// SPIKE PROTOTYPE for issue #852.
const preview: Preview = {
  parameters: {
    a11y: { test: 'error' },
    viewport: {
      options: {
        narrow: { name: 'Narrow (375px)', styles: { width: '375px', height: '812px' } },
        wide: { name: 'Wide (1440px)', styles: { width: '1440px', height: '900px' } },
      },
    },
  },
  decorators: [
    (Story) => (
      <UiWebProvider>
        <Story />
      </UiWebProvider>
    ),
  ],
}

export default preview

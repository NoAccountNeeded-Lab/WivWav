import type { StorybookConfig } from '@storybook/react-vite'

// SPIKE PROTOTYPE for issue #852.
const config: StorybookConfig = {
  stories: ['../src/stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
}

export default config

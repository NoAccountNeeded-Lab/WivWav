import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['support/**/*.integration.test.ts'],
  },
})

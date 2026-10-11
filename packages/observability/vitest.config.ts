import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: false,
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
})

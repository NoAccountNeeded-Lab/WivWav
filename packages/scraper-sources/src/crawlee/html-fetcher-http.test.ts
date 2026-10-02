import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DefaultCrawleeHtmlFetcher } from './html-fetcher.js'

let server: Server
let origin: string
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('User-agent: *\nAllow: /\n')
      return
    }
    const status = Number(request.url?.slice(1))
    response.writeHead(status, { 'content-type': 'text/html' })
    response.end('<html><body>Just a moment</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture port')
  origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

describe('real Crawlee blocked HTTP responses', () => {
  it.each([403, 429, 503])('surfaces a %i body instead of exhausting retries', async (status) => {
    const page = await new DefaultCrawleeHtmlFetcher().fetchOne(`${origin}/${status}`)
    expect(page.statusCode).toBe(status)
    expect(page.$('body').text()).toBe('Just a moment')
  }, 15_000)
})

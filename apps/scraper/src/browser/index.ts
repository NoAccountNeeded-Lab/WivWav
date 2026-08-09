// Relocated to @wivwav/scraper-sources (#950). This shim keeps existing
// import paths (including deliberate lazy `await import('../browser/index.js')`
// sites) working until the #948 cutover removes them.
export * from '@wivwav/scraper-sources/browser/index.js'

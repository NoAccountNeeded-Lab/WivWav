# Code Intelligence (TypeScript LSP)

Issue #1027 documents the local Claude Code [code intelligence
plugin](https://code.claude.com/docs/en/plugins/code-intelligence) setup for
this repository. A code intelligence plugin connects a Claude Code session to
a language server over LSP, so the agent sees real diagnostics after its own
edits and resolves symbols instead of grepping for them.

This is **per-developer local tooling, not a repository dependency.** Nothing
in the build, CI, or container path depends on it, and the repo cannot record
whether you have it: the plugin is enabled at `local` scope, which writes to
the untracked `.claude/settings.local.json`. Read this page when you want the
setup, or when diagnostics stop appearing and you need the first suspect.

## What it provides

| Capability | Effect in a session |
| --- | --- |
| Diagnostics after edits | Each Edit or Write to a handled file returns the server's errors and warnings, so a type error or missing import surfaces without running `pnpm typecheck` |
| Code navigation | The agent gets a read-only `LSP` tool for symbol lookup (definitions, references) in place of text search |

Diagnostics appear in the transcript only as a summary line —
`Found N new diagnostic issues in M files (ctrl+o to expand)`. Press
**Ctrl+O** to read the issues themselves.

The plugin adds no always-on context: `claude plugin details typescript-lsp`
reports `~0 tok` projected cost, because the language server runs
out-of-process.

## Setup

Two independent parts. The plugin declares the server command and the
extensions it handles; it does **not** bundle the server binary.

```bash
# 1. The language server binary (provides `typescript-language-server`)
npm install -g typescript-language-server typescript

# Confirm it is on the PATH of the shell you start `claude` from
which typescript-language-server

# 2. The plugin, from Anthropic's official marketplace
claude plugin install typescript-lsp@claude-plugins-official --scope local
```

`typescript-lsp` covers `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`,
and `.cjs` — effectively the whole workspace (651 `.ts` and 309 `.tsx` files
at the time of writing). Step 2 also works as `/plugin install
typescript-lsp@claude-plugins-official` inside a running session.

The global `typescript` package in step 1 is only a fallback; for files in
this workspace the server uses the repo's own pinned `typescript` from
`node_modules`.

### Why `local` scope

`--scope local` writes to `.claude/settings.local.json`, which is gitignored.
The alternative, `--scope project`, writes to `.claude/settings.json`, which
is tracked — enabling the plugin that way is a committed change to everyone's
configuration and belongs in its own PR, not in a local setup step.

### Activation

The install prints whether the plugin is active or needs a reload. The
language server itself starts lazily, on the **first edit to a matching file
in a new session** — so after installing, restart the session or run
`/reload-plugins`. A diagnostics summary line under an edit confirms it is
running.

Verify the installed state at any time:

```bash
claude plugin list                      # expect: typescript-lsp, scope local, enabled
claude plugin details typescript-lsp    # expect: LSP servers (1)  typescript
```

## When diagnostics stop appearing

Work down this list; the first two causes account for most of it.

1. **New session?** The server spawns on the first matching edit of a session.
   No edit to a handled file yet means no server yet.
2. **Is the binary still on `PATH`?** Run `which typescript-language-server`.
   This is the most likely cause of a setup that previously worked — see the
   nvm note below.
3. **Check `/plugin` → Errors tab.** A row reading
   `Executable not found in $PATH: "typescript-language-server"` names the
   problem directly. `claude --debug` logs the same as
   `LSP server typescript failed to start: <reason>`.
4. **Is the plugin still enabled?** `claude plugin list`.

### nvm path drift is the usual culprit

`npm install -g` places the binary under the **active Node version's**
directory, for example
`~/.nvm/versions/node/v26.5.0/bin/typescript-language-server`. Switching Node
majors with `nvm use` removes it from `PATH`, and the only symptom is the
`Executable not found in $PATH` row in step 3 above. Re-run the `npm install
-g` from step 1 under the Node version you now use.

This repo pins `engines.node` to `>=26 <27` and enforces it at install time
(see [Node Runtime Alignment](node-runtime-alignment.md)), so drift is
unlikely here — but it is the first thing to check.

## Known non-bugs

**Unresolved `@wivwav/*` imports.** A language server not configured for the
pnpm workspace reports imports of internal packages as unresolved. Per
Anthropic's plugin troubleshooting page there is nothing to fix on the Claude
Code side, and the false diagnostics do not stop the agent from editing code.
Trust `pnpm typecheck` over the server for cross-package resolution.

**No diagnostics in cloud sessions.** Claude Code does not start plugin
language servers in cloud sessions, so the agent gets neither diagnostics nor
the `LSP` tool there, regardless of local setup. This applies to work run via
`claude --cloud` and to cloud-run reviews. Local terminal sessions only.

**Memory use while indexing.** The server indexes the project, which costs
memory on a workspace this size. `/plugin disable typescript-lsp` is the
escape hatch on a constrained machine; the agent falls back to its built-in
search tools.

## Why only TypeScript

`pyright-lsp` is deliberately not installed. The only Python in the repo is
six CI helper scripts under `.github/scripts/`, and pyright indexes the whole
project — a poor trade for six files that no local workflow edits. Anthropic's
troubleshooting page names `pyright` specifically among servers whose indexing
is memory-hungry.

Plugins for other languages, should the repo ever need one, are listed in the
[code intelligence
docs](https://code.claude.com/docs/en/plugins/code-intelligence); the setup
shape is identical — install the binary, then the plugin at `local` scope.

# Your CLI Tool Needs an MCP Server: Shipping One in a Day, Protocol by Hand

> Published on {{DATE}} · xbrowser v{{VERSION}}

Every CLI tool built before 2026 is asking itself the same question: how do AI agents discover me? The answer the ecosystem converged on is the Model Context Protocol — MCP. If Claude Desktop, Cursor, or any MCP-capable client can list your tool's capabilities and call them, your tool exists for agents. If not, it doesn't.

[xbrowser]({{GITHUB_URL}}) is a browser-automation CLI (57 commands, 130+ site plugins, self-healing replay). This week we shipped `xbrowser mcp` — a stdio MCP server exposing 7 browser tools. This post is the build log: the design decisions, the two real bugs the first smoke run caught, and why we wrote the protocol layer by hand.

## Why hand-write the JSON-RPC layer?

The official `@modelcontextprotocol/sdk` is fine software. We didn't use it, for three reasons that generalize:

1. **The protocol surface we need is tiny.** An MCP server over stdio is JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`, plus an error path. That's a switch statement — about 60 lines including the newline-delimited framing. The SDK's value is in the long tail (resources, prompts, transports, typed helpers) that a 7-tool server doesn't touch.
2. **Dependency discipline compounds.** A CLI that installs globally feels every dependency's weight. Zero new dependencies for MCP means zero new install failure modes, zero audit noise, zero version drift.
3. **Debuggability.** When something breaks at 2am, a 60-line protocol loop you fully understand beats a framework abstraction you partially understand.

The whole protocol layer is small enough to hold in your head — which is exactly the property you want in the layer agents depend on.

## The thin-shell design

The key decision: **the MCP server rewrites no automation logic.** Every tool call bottoms out in the same `executeChain` / `executeCommand` functions the CLI uses:

```typescript
case 'browser_navigate': {
  const url = args.url as string;
  let chain = `goto ${url}`;
  if (args.chain) chain += ` && ${args.chain}`;   // follow-up commands as a chain
  const result = await executeChain(chain, { sessionName: session });
  return text({ ok: result.success, steps: ... });
}
```

This buys three things: one execution path to test (the CLI's 4000-test suite already covers it), one place to fix bugs, and automatic feature parity — when the replay engine gains a new healing strategy, MCP users get it the same day. The MCP layer is a *translation* concern (JSON-RPC ↔ CLI), and translation layers should be boring.

The 7 tools were chosen for agent ergonomics, not CLI symmetry: `browser_navigate` (with optional follow-up chain), `browser_act` (click/fill/press/…), `browser_read` (text/html/title), `browser_snapshot` (accessibility tree — the token-efficient page view), `browser_screenshot`, `browser_network` (request inspection), and `browser_replay` (the self-healing replay engine — our differentiator, exposed as a single tool call).

## Two real bugs the smoke run caught

Both are the kind of thing you only find by running the real thing.

**Bug 1: the CLI ate the protocol.** Our entrypoint reads stdin when piped — that's how `echo "goto x && title" | xbrowser` works. To an MCP client, the server's stdin *is* the protocol channel. The first test sent `initialize` and the CLI helpfully tried to execute `{"jsonrpc":"2.0"...}` as a browser command. Fix: `mcp` short-circuits stdin collection; protocol lines and command lines never mix.

**Bug 2: the shutdown race.** Our smoke test piped requests from a file; EOF arrived while the browser was still launching for `tools/call`. The `stdin end → process.exit(0)` handler killed the in-flight request mid-flight. Real clients keep stdin open, so they'd never hit it — but a server that dies with pending work is wrong on principle. Fix: an inflight counter; exit only when stdin is closed *and* nothing is pending. Requests finish, then the process leaves.

Neither bug appears in the SDK's examples, because both live at the *integration* boundary between an existing CLI and the protocol — which is exactly where your bugs will live too.

## Validation without a client

You don't need Claude Desktop to test an MCP server. A 50-line smoke script spawns the server, writes four JSON-RPC lines (initialize, tools/list, unknown method, unknown tool), and asserts the responses: server info correct, exactly 7 tools, `-32601` for bad methods, `isError` content for bad tools. That's now in the repo as `scripts/mcp-smoke.mjs` and takes 2 seconds to run. Protocol conformance is testable with plain processes — no client required.

For the real thing: `claude mcp add xbrowser -- xbrowser mcp`, then ask any MCP-capable agent to open a page and snapshot it.

## What we'd tell you to do first

If you maintain a CLI with an agent-relevant surface (browser, files, HTTP, search — most CLIs qualify), an MCP server is probably a day of work: enumerate 5–10 verbs agents actually need, wire them to your existing functions, hand-write the protocol loop, smoke-test with processes. The hard part isn't the protocol — it's the boundary decisions: which verbs, what granularity, how errors surface as tool results instead of crashes.

xbrowser is MIT-licensed: [{{GITHUB_URL}}]({{GITHUB_URL}}) · npm: [{{NPM_URL}}]({{NPM_URL}})

*This post was drafted through xbrowser's own content pipeline, and the `browser_*` tools above are the same ones any MCP agent gets.*

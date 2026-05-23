import { version } from '../version.js';

export function showMainHelp(): void {
  console.log(`
xbrowser v${version} - Browser Automation CLI

Usage:
  xbrowser <command> [options]          Execute a single command
  xbrowser "cmd1 && cmd2 && cmd3"       Execute command chain
  echo "cmd" | xbrowser                 Execute from pipe/stdin
  xbrowser run commands.txt             Execute commands from file
  xbrowser -e cmd1 -e cmd2             Execute multiple -e commands

Commands:
  session open <url> [--name <n>]   Open browser session
  session close [--name <n>]        Close session
  session list                      List sessions
  session kill [--name <n>]         Kill session
  goto <url>                        Navigate to URL
  click <selector>                  Click element (-s <sel>)
  fill <selector> <value>           Fill input (-s <sel> -v <val>)
  type <selector> <text>            Type text (-s <sel> -v <text>)
  press <selector> <key>            Press key (-s <sel> -v <key>)
  select <selector> <value>         Select option (-s <sel> -v <val>)
  hover <selector>                  Hover element (-s <sel>)
  dblclick <selector>               Double click (-s <sel>)
  check <selector>                  Check checkbox (-s <sel>)
  uncheck <selector>                Uncheck checkbox (-s <sel>)
  screenshot [--full-page]          Take screenshot
  eval <expression>                 Evaluate JS
  wait <selector> [--timeout <ms>]  Wait for element (-s <sel>)
  scroll <direction> [--distance N] Scroll page
  title                             Get page title
  url                               Get current URL
  html [--selector <sel>]           Get HTML content
  text [--selector <sel>]           Get text content
  convert <rec.yaml> <out.{js,py,sh}> Convert recording to script
  extract <rec.yaml>                Extract LLM-ready summary
  filter <in.yaml> <out.yaml>       Filter recording events
  scrape <url>                      Scrape a page and convert to markdown
   crawl <url>                       Crawl a website and extract content from multiple pages
   search "query"                    Search the web and extract results (--engine, --limit, --full)
   map <url>                         Discover all URLs on a website
  config <get|set|list>             Manage config
  plugin search <query>             Search for plugins
  plugin install <source>           Install plugin
  plugin uninstall <name>           Uninstall plugin
  plugin list                       List plugins
  plugin reload <name>              Reload plugin
  create <name> --template <type>   Create plugin
  daemon start [--port <port>]      Start daemon
  daemon stop                       Stop daemon
  daemon status                     Check status
  serve [--port <port>] [--token <t>] Start HTTP server for remote access
  remote <url> [command] [--token <t>] Execute command on remote server
  record start --url <url>          Start recording
  record stop                       Stop recording
  record status                     Recording status
  replay <file>                     Replay recording
  run <file>                        Execute commands from file
  help                              Show this help
  --version, -v                     Show version

Marketplace & Admin:
  marketplace publish [--dry-run]   Publish plugin to marketplace
  marketplace login [--token <key>] Login to marketplace
  marketplace register              Register developer account
  marketplace whoami                Show current user
  marketplace logout                Logout from marketplace
  admin pending                     List pending plugins (admin only)
  admin approve <slug>              Approve a plugin (admin only)
  admin reject <slug> [--reason]    Reject a plugin (admin only)
  admin feature <slug>              Toggle featured (admin only)
  admin remove <slug>               Remove a plugin (admin only)
  admin stats                       Dashboard stats (admin only)
  admin inventory                   Plugin inventory (admin only)
  admin list [--status <status>]    List all plugins (admin only)
  admin bulk-approve <slugs...>     Bulk approve (admin only)
  admin cleanup                     Reset data (admin only)

Plugin Commands:
  Installed plugins provide additional commands.
  Use 'xbrowser plugin list' to see installed plugins and their commands.
  Use 'xbrowser <command> --help' for details on any specific command.

Chain Execution (shell-safe, no quotes needed):
   xbrowser goto https://example.com , title , click btn
   xbrowser goto https://example.com + title + screenshot
   xbrowser goto https://example.com -> title -> click btn
   (comma, plus, arrow must have spaces around them)

Chain Execution (needs quotes):
   xbrowser "goto https://example.com && title && click '#btn'"
   xbrowser "goto https://example.com ; screenshot"

Pipe / Stdin:
  echo "goto https://example.com" | xbrowser
  printf "goto https://example.com\\ntitle\\nclick btn\\n" | xbrowser
  xbrowser <<EOF
  goto https://example.com
  title
  click btn
  EOF

Run from File:
  xbrowser run commands.txt
  # commands.txt: one command per line, # for comments, blank lines ok

Eval Flag:
  xbrowser -e "goto https://example.com" -e title -e "click btn"

Selector Syntax:
  xbrowser click '#btn'              Quoted (handles # in shell)
  xbrowser click -s #btn             Flag form (-s = --selector)
  xbrowser click btn                 Auto-prefix # (treated as #btn)
  xbrowser click .class              Class selector
  xbrowser click [data-id=x]         Attribute selector
  xbrowser fill -s #input -v hello   Fill with flags (-v = --value)

Global Flags:
  --json                            Output as JSON
  --yaml                            Output as YAML
  --session <name>                  Use specific session
  --cdp <endpoint>                  Connect via CDP (url, port, or 'auto')
  --help, -h                        Show help
  `);
}

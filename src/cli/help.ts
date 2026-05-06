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
  config <get|set|list>             Manage config
  plugin search <query>             Search for plugins
  plugin install <source>           Install plugin
  plugin uninstall <name>           Uninstall plugin
  plugin list                       List plugins
  plugin reload <name>              Reload plugin
  plugin publish [--dry-run]        Publish plugin to marketplace
  plugin register                   Register developer account
  plugin login [--token <key>]      Login to marketplace
  plugin whoami                     Show current user
  plugin logout                     Logout from marketplace
  admin pending                     List pending plugins
  admin approve <slug>              Approve a plugin
  admin reject <slug> [--reason]    Reject a plugin
  admin feature <slug>              Toggle featured status
  admin remove <slug>               Remove a plugin
  admin stats                       Dashboard stats
  admin inventory                   Full plugin inventory
  admin list [--status <status>]    List all plugins
  admin bulk-approve <slugs...>     Bulk approve plugins
  admin cleanup                     Reset fake data
  create <name> --template <type>   Create plugin
  daemon start [--port <port>]      Start daemon
  daemon stop                       Stop daemon
  daemon status                     Check status
  record start --url <url>          Start recording
  record stop                       Stop recording
  record status                     Recording status
  replay <file>                     Replay recording
  run <file>                        Execute commands from file
  help                              Show this help
  --version, -v                     Show version

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

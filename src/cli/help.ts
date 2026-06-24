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
  session close [--session <name>]  Close session
  session list                      List sessions
  session kill [--session <name>]   Kill session

  goto <url>                        Navigate to URL
  open <url>                        Navigate to URL (alias for goto)
  back                              Go back in history
  forward                           Go forward in history
  refresh                           Reload page

  click <selector>                  Click element (-s <sel>)
  fill <selector> <value>           Fill input (-s <sel> -v <val>)
  type <selector> <text>            Type text (-s <sel> -v <text>)
  press <selector> <key>            Press key (-s <sel> -v <key>)
  select <selector> <value>         Select option (-s <sel> -v <val>)
  hover <selector>                  Hover element (-s <sel>)
  dblclick <selector>               Double click (-s <sel>)
  check <selector>                  Check checkbox (-s <sel>)
  uncheck <selector>                Uncheck checkbox (-s <sel>)
  mouse <action> <x> <y>            Mouse move/click at coordinates
  scroll <direction> [--distance N] Scroll page

  screenshot [--full-page] [--base64]  Take screenshot
  eval <expression>                 Evaluate JS
  wait <selector> [--timeout <ms>]  Wait for element (-s <sel>)
  waitForTimeout <ms>               Wait for milliseconds
  waitFor --text <t>                Wait for text/url/selector predicate
  title                             Get page title
  url                               Get current URL
  html [--selector <sel>]           Get HTML content
  text [--selector <sel>]           Get text content
  find <strategy> <value> [--action click|fill|hover]  Find element by text/role/label

  set-viewport <width> <height>     Set viewport size
  frames                            List all frames
  frame --index <n>                 Switch to frame
  tab list                          List browser tabs
  tab new <url>                     Open new tab
  tab close --index <n>             Close tab
  tab switch --index <n>            Switch to tab

  get-cookies                       Get all cookies
  set-cookie <name> <value>         Set cookie
  clear-cookies                     Clear cookies
  get-local-storage                 Get localStorage
  set-local-storage <key> <value>   Set localStorage item
  clear-local-storage               Clear localStorage

  snapshot                          Get page snapshot with element refs
  observe                           AI agent: observe page state
  act                               AI agent: perform action
  actions <url> --action "..."      Execute action sequence

  console                           Get console messages
  net-debug                         Get network debug info
  perf                              Get performance metrics
  health                            Run page health check (SEO/links/errors)
  structure                         Get page DOM structure
  network <url>                     Capture network traffic
  addinitscript <script>            Add init script

  scrape <url>                      Scrape page to markdown
  crawl <url>                       Crawl website (multi-page)
  search "query"                    Search the web (--engine, --limit, --full)
  map <url>                         Discover all URLs on a website

  convert <rec.yaml> <out.{js,py,sh}> Convert recording to script
  extract <rec.yaml>                Extract LLM-ready summary
  filter <in.yaml> <out.yaml>       Filter recording events
  replay <file>                     Replay recording
  record start --url <url>          Start recording
  record stop                       Stop recording
  record status                     Recording status

  config <get|set|list>             Manage config
  plugin search <query>             Search for plugins
  plugin install <source>           Install plugin
  plugin uninstall <name>           Uninstall plugin
  plugin list                       List plugins
  plugin reload <name>              Reload plugin
  create <name> --template <type>   Create plugin
  serve [--port <port>] [--token <t>] Start HTTP server
  remote <url> [command] [--token <t>] Execute on remote server
  run <file>                        Execute commands from file
  viewer [--name <n>]               Generate viewer URL
  help                              Show this help
  --version                         Show version
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

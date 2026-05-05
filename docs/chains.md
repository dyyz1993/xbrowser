# Command Chains

Guide to chaining multiple commands in xbrowser.

## Overview

Command chains allow you to execute multiple commands in a single invocation. This is especially useful for automation and scripting.

## Chain Separators

### && (AND Separator)

Execute commands sequentially, stop on first failure.

```bash
xbrowser "goto https://example.com && title && screenshot"
```

**Behavior:**
- All commands execute if all succeed
- Stops immediately if any command fails

### , (Comma Separator)

Execute commands sequentially, continue on errors.

```bash
xbrowser "goto https://example.com , title , screenshot"
```

**Behavior:**
- All commands execute regardless of success/failure
- Errors are logged but don't stop execution

### + (Plus Separator)

Same as comma, continue on errors.

```bash
xbrowser "goto https://example.com + title + screenshot"
```

### -> (Arrow Separator)

Visual flow indicator, same as comma.

```bash
xbrowser "goto https://example.com -> title -> screenshot"
```

### ; (Semicolon Separator)

Flush current pipeline, start new pipeline.

```bash
xbrowser "goto https://example.com ; goto https://other.com"
```

**Behavior:**
- Commands before `;` execute in one pipeline
- Commands after `;` execute in a new pipeline
- Useful for grouping related commands

### || (OR Separator)

Execute commands, stop on first success.

```bash
xbrowser "goto https://primary.com || goto https://fallback.com"
```

**Behavior:**
- Skips subsequent commands if any succeeds
- Useful for fallback logic

## Examples

### Basic Chain

```bash
xbrowser "goto https://example.com && title && screenshot"
```

### Multi-Step Automation

```bash
xbrowser "goto https://example.com/login && fill '#username' 'alice' && fill '#password' 'secret' && click '#submit' && wait '.dashboard' && screenshot"
```

### Fallback Logic

```bash
xbrowser "goto https://primary.com || goto https://fallback.com && title"
```

### Grouping with Semicolon

```bash
xbrowser "goto https://site1.com ; goto https://site2.com ; title"
```

### Error Continuation

```bash
xbrowser "goto https://example.com , click '#button' , text --selector '#result'"
```

## Advanced Usage

### Nested Conditions

```bash
xbrowser "goto https://example.com && (click '#login' || click '#signin') && fill '#username' 'user'"
```

### Loops with Shell

```bash
for url in https://site1.com https://site2.com https://site3.com; do
  xbrowser "goto $url && title && screenshot"
done
```

### Conditionals

```bash
xbrowser "goto https://example.com && eval 'document.title.includes(\"Error\")' && (click '#retry' || exit 1)"
```

### Parallel Execution

```bash
xbrowser "goto https://example.com & title & screenshot" &
```

## Command Chain Parsing

### Quote Rules

```bash
# Good - quoted selector
xbrowser "goto https://example.com && click '#button'"

# Good - selector quoted
xbrowser goto https://example.com && click '#button'

# Bad - # is shell comment
xbrowser goto https://example.com && click #button
```

### Argument Handling

```bash
# Long arguments
xbrowser "goto https://example.com && fill '#input' 'very long text with spaces'"

# Flags
xbrowser "goto https://example.com --waitUntil networkidle && screenshot --full-page"

# Multiple flags
xbrowser "goto https://example.com && screenshot --full-page --type jpeg --quality 90"
```

## Output Control

### JSON Output for Chain

```bash
xbrowser --json "goto https://example.com && title"
```

**Output:**
```json
{
  "success": true,
  "steps": [
    {
      "command": "goto",
      "success": true,
      "duration": 523,
      "result": { "ok": true }
    },
    {
      "command": "title",
      "success": true,
      "duration": 12,
      "result": { "ok": true, "title": "Example Domain" }
    }
  ],
  "totalDuration": 535
}
```

### YAML Output for Chain

```bash
xbrowser --yaml "goto https://example.com && title"
```

## Error Handling

### Stop on Error (&&)

```bash
xbrowser "goto https://example.com && click '#nonexistent' && title"
```

**Result:** Stops at `click` command, `title` never executes.

### Continue on Error (,)

```bash
xbrowser "goto https://example.com , click '#nonexistent' , title"
```

**Result:** All commands execute, errors logged.

### Fallback (||)

```bash
xbrowser "goto https://nonexistent.com || goto https://example.com && title"
```

**Result:** First URL fails, second URL succeeds.

## Practical Examples

### Web Scraping

```bash
xbrowser "goto https://example.com/products && html --selector '.product' > products.html"
```

### Form Automation

```bash
xbrowser <<EOF
goto https://example.com/register
fill '#username' 'newuser'
fill '#email' 'user@example.com'
fill '#password' 'securepass'
click '#submit'
wait '.success'
screenshot
EOF
```

### Data Collection

```bash
xbrowser "goto https://example.com && text --selector '.price' | jq '.split(\"\\n\") | .[]' > prices.txt"
```

### Multi-Site Monitoring

```bash
for site in site1.com site2.com site3.com; do
  xbrowser "goto https://$site && title && screenshot --path $site.png"
done
```

### Login and Navigation

```bash
xbrowser "goto https://example.com/login && fill '#user' 'admin' && fill '#pass' 'secret' && click '#login' && wait '.dashboard' && goto https://example.com/admin"
```

### Search and Extract

```bash
xbrowser "goto https://example.com && fill '#search' 'playwright' && click '#search-btn' && wait '.results' && html --selector '.results' > results.html"
```

## Performance Tips

### Use Semicolon for Independent Operations

```bash
# Slower - each waits for previous
xbrowser "goto https://site1.com && goto https://site2.com && goto https://site3.com"

# Faster - each is independent pipeline
xbrowser "goto https://site1.com ; goto https://site2.com ; goto https://site3.com"
```

### Minimize Screenshot Overhead

```bash
# Multiple screenshots
xbrowser "goto https://example.com && screenshot && click '#button' && screenshot"

# Single screenshot at end
xbrowser "goto https://example.com && click '#button' && screenshot"
```

### Use Daemon for Frequent Commands

```bash
# Start daemon
xbrowser daemon start

# Commands are faster with daemon
xbrowser "goto https://example.com && title && screenshot"
```

## Best Practices

### 1. Quote Selectors

```bash
# Good
xbrowser "click '#button'"

# Bad
xbrowser click '#button'
```

### 2. Use Meaningful Separators

```bash
# Good - && for dependent commands
xbrowser "goto https://example.com && click '#button'"

# Good - , for independent commands
xbrowser "title , screenshot"
```

### 3. Handle Errors Appropriately

```bash
# Good - stop on critical failure
xbrowser "login && navigate && extract"

# Good - continue on non-critical
xbrowser "title , screenshot , log"
```

### 4. Use Heredoc for Complex Chains

```bash
xbrowser <<EOF
goto https://example.com
fill '#username' 'user'
fill '#password' 'pass'
click '#submit'
wait '.dashboard'
screenshot
EOF
```

## Troubleshooting

### Quotes Not Working

```bash
# Problem: # is shell comment
xbrowser goto https://example.com && click #button

# Solution: quote selector
xbrowser "goto https://example.com && click '#button'"
```

### Chain Not Executing

```bash
# Problem: command not recognized
xbrowser goto https://example.com && non-existent

# Solution: quote entire chain
xbrowser "goto https://example.com && title"
```

### Timeout in Chain

```bash
# Problem: long-running command times out
xbrowser "goto https://example.com && long-operation && screenshot"

# Solution: increase timeout for specific command
xbrowser "goto https://example.com && long-operation --timeout 120000 && screenshot"
```

## See Also

- [Commands Reference](./commands.md) — All available commands
- [Quick Start](./quickstart.md) — Getting started guide
- [Architecture](./architecture.md) — How chains are executed

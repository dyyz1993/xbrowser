# Doubao Music Generation API Structure

## Endpoint
`chat/completion` (POST)

## Request Body Structure
The `messages[0].content` field is a JSON string containing:
- `text`: The description of the music to generate
- `lyric`: Custom lyrics (only used when `generation_type` is `"custome_lyric"`)
- `theme`: Theme of the music
- `mood`: Mood of the music. Options: `"Happy"`, `"Sad"`, `"Passionate"`, `"Gentle"`
- `genre`: Genre of the music. Options: `"Pop"`, `"Rock"`, `"Folk"`, `"Classical"`
- `gender`: Voice gender. Options: `"Female"`, `"Male"`, `"Child"`
- `generation_type`: Either `"ai_lyric"` (AI writes lyrics) or `"custome_lyric"` (custom lyrics mode)

## UI Interaction Notes
- The dropdown menu to switch between AI/custom lyrics: `button:has-text("AI 帮我写歌词")` → click → `[role="menuitem"]:has-text("自定义歌词")`
- The lyrics editor is Slate.js-based, must use `page.keyboard.type()` to fill text (not `document.execCommand('insertText')`)

## xbrowser CLI Usage
```bash
# AI writes lyrics
xbrowser doubao music --description "一首关于春天的歌" --theme "春天" --mood Happy --genre Pop

# Custom lyrics
xbrowser doubao music --lyric "春风吹过花丛中\n蝴蝶翩翩起舞" --theme "春天" --mood Happy --genre Pop

# Debug mode (logs API requests to ~/.xbrowser/debug/music-*.jsonl)
xbrowser doubao music --description "测试" --debug
```

## Smart Tips (implemented in plugin)
- When `lyric` field is empty and `generation_type` is `"custome_lyric"`, warns user
- When `theme` field is empty, warns user to specify a theme
- Both `description` and `lyric` cannot be empty simultaneously

## Debug Output
Debug mode saves API request/response to `~/.xbrowser/debug/music-{timestamp}.jsonl`

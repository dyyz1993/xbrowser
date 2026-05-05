# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-05-05

### Added
- Interactive WebSocket preview with screencast support
- Plugin search with npm registry integration
- Plugin metadata parser for richer information
- Command chains with shell-safe separators (`,`, `+`, `->`)
- Pipe and file input modes for command execution
- `-e` flag for inline command execution
- WebSocket server for real-time browser interaction
- Rich documentation (quickstart, chains, preview, WebSocket)

### Changed
- Improved router architecture
- Better daemon session management
- Enhanced built-in commands structure
- Improved plugin installation workflow

### Fixed
- Command name aliases
- Double-wrap in ok() function
- Session cleanup issues

### Performance
- Optimized plugin loading
- Better command execution performance

## [0.1.4] - Previous
- Initial CLI release

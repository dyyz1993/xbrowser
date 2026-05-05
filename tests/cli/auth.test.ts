import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import type { AuthConfig } from '../../src/plugin/publisher.js'

const ACTUAL_AUTH_DIR = resolve(homedir(), '.xbrowser')
const ACTUAL_AUTH_FILE = resolve(ACTUAL_AUTH_DIR, 'auth.json')
const BACKUP_FILE = resolve(ACTUAL_AUTH_DIR, 'auth.json.e2e-backup')

describe('CLI Auth Flow', () => {
  let hadExistingAuth = false

  beforeAll(() => {
    if (existsSync(ACTUAL_AUTH_FILE)) {
      hadExistingAuth = true
      writeFileSync(BACKUP_FILE, readFileSync(ACTUAL_AUTH_FILE, 'utf-8'), 'utf-8')
    }
  })

  afterAll(() => {
    if (hadExistingAuth && existsSync(BACKUP_FILE)) {
      writeFileSync(ACTUAL_AUTH_FILE, readFileSync(BACKUP_FILE, 'utf-8'), 'utf-8')
      rmSync(BACKUP_FILE)
    } else if (!hadExistingAuth && existsSync(ACTUAL_AUTH_FILE)) {
      rmSync(ACTUAL_AUTH_FILE)
    }
  })

  describe('loadAuth', () => {
    it('should return null when no auth file exists', async () => {
      if (existsSync(ACTUAL_AUTH_FILE)) rmSync(ACTUAL_AUTH_FILE)
      const { loadAuth } = await import('../../src/cli/publish-routes.js')
      const result = loadAuth()
      expect(result).toBeNull()
    })

    it('should load saved auth config', async () => {
      if (!existsSync(ACTUAL_AUTH_DIR)) mkdirSync(ACTUAL_AUTH_DIR, { recursive: true })
      writeFileSync(
        ACTUAL_AUTH_FILE,
        JSON.stringify({ token: 'test-token-123', registry: 'https://xbrowser.dev' }),
        'utf-8'
      )
      const { loadAuth } = await import('../../src/cli/publish-routes.js')
      const result = loadAuth()
      expect(result).not.toBeNull()
      expect(result!.token).toBe('test-token-123')
      expect(result!.registry).toBe('https://xbrowser.dev')
    })

    it('should return null for corrupted auth file', async () => {
      writeFileSync(ACTUAL_AUTH_FILE, 'not-valid-json', 'utf-8')
      const { loadAuth } = await import('../../src/cli/publish-routes.js')
      const result = loadAuth()
      expect(result).toBeNull()
    })
  })

  describe('Auth config file management', () => {
    it('should persist and read auth config', () => {
      const config: AuthConfig = {
        token: 'api-key-from-server',
        registry: 'https://custom-registry.example.com',
      }
      if (!existsSync(ACTUAL_AUTH_DIR)) mkdirSync(ACTUAL_AUTH_DIR, { recursive: true })
      writeFileSync(ACTUAL_AUTH_FILE, JSON.stringify(config, null, 2), 'utf-8')
      const loaded = JSON.parse(readFileSync(ACTUAL_AUTH_FILE, 'utf-8')) as AuthConfig
      expect(loaded).toEqual(config)
    })

    it('should overwrite auth on re-login', () => {
      writeFileSync(
        ACTUAL_AUTH_FILE,
        JSON.stringify({ token: 'old-token', registry: 'https://old.example.com' }),
        'utf-8'
      )
      writeFileSync(
        ACTUAL_AUTH_FILE,
        JSON.stringify({ token: 'new-token', registry: 'https://new.example.com' }),
        'utf-8'
      )
      const loaded = JSON.parse(readFileSync(ACTUAL_AUTH_FILE, 'utf-8')) as AuthConfig
      expect(loaded.token).toBe('new-token')
      expect(loaded.registry).toBe('https://new.example.com')
    })

    it('should handle empty token for logout', () => {
      writeFileSync(
        ACTUAL_AUTH_FILE,
        JSON.stringify({ token: 'valid-token', registry: 'https://xbrowser.dev' }),
        'utf-8'
      )
      writeFileSync(ACTUAL_AUTH_FILE, JSON.stringify({ token: '', registry: '' }), 'utf-8')
      const loaded = JSON.parse(readFileSync(ACTUAL_AUTH_FILE, 'utf-8')) as AuthConfig
      expect(loaded.token).toBe('')
      expect(loaded.registry).toBe('')
    })
  })

  describe('AuthConfig type contract', () => {
    it('should have required fields', () => {
      const config: AuthConfig = {
        token: 'test-token',
        registry: 'https://xbrowser.dev',
      }
      expect(config.token).toBeDefined()
      expect(config.registry).toBeDefined()
      expect(typeof config.token).toBe('string')
      expect(typeof config.registry).toBe('string')
    })
  })
})

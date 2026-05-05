import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginMetadataParser } from '../../src/plugin/metadata-parser.js';
import type { NPMPluginSearchResult } from '../../src/plugin/types.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-metadata-parser');

describe('PluginMetadataParser', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  describe('parseFromPackageJson', () => {
    it('should parse xbrowser metadata from package.json', () => {
      const pluginPath = resolve(TEST_DIR, 'test-plugin');
      mkdirSync(pluginPath, { recursive: true });

      writeFileSync(
        resolve(pluginPath, 'package.json'),
        JSON.stringify({
          name: 'xbrowser-plugin-test',
          version: '1.0.0',
          xbrowser: {
            id: 'test-plugin',
            name: 'Test Plugin',
            description: 'A test plugin',
            version: '1.0.0',
            author: 'Test Author',
            homepage: 'https://example.com',
            commands: ['cmd1', 'cmd2'],
            sites: ['example.com'],
            tags: ['test', 'demo'],
          },
        })
      );

      const metadata = PluginMetadataParser.parseFromPackageJson(pluginPath);

      expect(metadata).not.toBeNull();
      expect(metadata?.id).toBe('test-plugin');
      expect(metadata?.name).toBe('Test Plugin');
      expect(metadata?.description).toBe('A test plugin');
      expect(metadata?.author).toBe('Test Author');
      expect(metadata?.commands).toEqual(['cmd1', 'cmd2']);
    });

    it('should return null when package.json does not exist', () => {
      const metadata = PluginMetadataParser.parseFromPackageJson('/nonexistent/path');

      expect(metadata).toBeNull();
    });

    it('should return null when xbrowser metadata is missing', () => {
      const pluginPath = resolve(TEST_DIR, 'no-metadata');
      mkdirSync(pluginPath, { recursive: true });

      writeFileSync(
        resolve(pluginPath, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          version: '1.0.0',
        })
      );

      const metadata = PluginMetadataParser.parseFromPackageJson(pluginPath);

      expect(metadata).toBeNull();
    });

    it('should fall back to package.json fields when xbrowser fields are missing', () => {
      const pluginPath = resolve(TEST_DIR, 'fallback');
      mkdirSync(pluginPath, { recursive: true });

      writeFileSync(
        resolve(pluginPath, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          version: '1.0.0',
          description: 'A test plugin',
          author: 'Test Author',
          xbrowser: {},
        })
      );

      const metadata = PluginMetadataParser.parseFromPackageJson(pluginPath);

      expect(metadata).not.toBeNull();
      expect(metadata?.id).toBe('test-plugin');
      expect(metadata?.name).toBe('test-plugin');
      expect(metadata?.description).toBe('A test plugin');
      expect(metadata?.author).toBe('Test Author');
    });
  });

  describe('isXBrowserPlugin', () => {
    it('should return true when xbrowser metadata exists', () => {
      const packageJson = {
        name: 'test-plugin',
        xbrowser: { id: 'test' },
      };

      expect(PluginMetadataParser.isXBrowserPlugin(packageJson)).toBe(true);
    });

    it('should return true when xbrowser keyword is present', () => {
      const packageJson = {
        name: 'test-plugin',
        keywords: ['xbrowser', 'test'],
      };

      expect(PluginMetadataParser.isXBrowserPlugin(packageJson)).toBe(true);
    });

    it('should return true when xbrowser-plugin keyword is present', () => {
      const packageJson = {
        name: 'test-plugin',
        keywords: ['xbrowser-plugin', 'test'],
      };

      expect(PluginMetadataParser.isXBrowserPlugin(packageJson)).toBe(true);
    });

    it('should return false when no xbrowser metadata or keywords', () => {
      const packageJson = {
        name: 'test-plugin',
        keywords: ['test', 'demo'],
      };

      expect(PluginMetadataParser.isXBrowserPlugin(packageJson)).toBe(false);
    });
  });

  describe('fromNPMResult', () => {
    it('should convert npm search result to metadata', () => {
      const npmResult: NPMPluginSearchResult = {
        name: 'xbrowser-plugin-test',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        homepage: 'https://example.com',
        keywords: ['test', 'demo'],
        date: '2024-01-01',
      };

      const metadata = PluginMetadataParser.fromNPMResult(npmResult);

      expect(metadata).not.toBeNull();
      expect(metadata?.id).toBe('xbrowser-plugin-test');
      expect(metadata?.name).toBe('test');
      expect(metadata?.description).toBe('A test plugin');
      expect(metadata?.author).toBe('Test Author');
      expect(metadata?.tags).toEqual(['test', 'demo']);
    });

    it('should handle scoped package names', () => {
      const npmResult: NPMPluginSearchResult = {
        name: '@scope/xbrowser-plugin-test',
        version: '1.0.0',
        description: 'A test plugin',
        author: { name: 'Test Author' },
        date: '2024-01-01',
      };

      const metadata = PluginMetadataParser.fromNPMResult(npmResult);

      expect(metadata?.name).toBe('xbrowser-plugin-test');
      expect(metadata?.author).toBe('Test Author');
    });

    it('should handle author as object', () => {
      const npmResult: NPMPluginSearchResult = {
        name: 'xbrowser-plugin-test',
        version: '1.0.0',
        description: 'A test plugin',
        author: { name: 'Test Author' },
        date: '2024-01-01',
      };

      const metadata = PluginMetadataParser.fromNPMResult(npmResult);

      expect(metadata?.author).toBe('Test Author');
    });

    it('should handle missing author', () => {
      const npmResult: NPMPluginSearchResult = {
        name: 'xbrowser-plugin-test',
        version: '1.0.0',
        description: 'A test plugin',
        date: '2024-01-01',
      };

      const metadata = PluginMetadataParser.fromNPMResult(npmResult);

      expect(metadata?.author).toBe('Unknown');
    });
  });

  describe('extractAuthor', () => {
    it('should extract author name from string', () => {
      const author = PluginMetadataParser.extractAuthor('Test Author');
      expect(author).toBe('Test Author');
    });

    it('should extract author name from object', () => {
      const author = PluginMetadataParser.extractAuthor({ name: 'Test Author' });
      expect(author).toBe('Test Author');
    });

    it('should return Unknown for null', () => {
      const author = PluginMetadataParser.extractAuthor(null);
      expect(author).toBe('Unknown');
    });

    it('should return Unknown for object without name', () => {
      const author = PluginMetadataParser.extractAuthor({ email: 'test@example.com' });
      expect(author).toBe('Unknown');
    });
  });

  describe('validateMetadata', () => {
    it('should return empty array for valid metadata', () => {
      const metadata = {
        id: 'test-plugin',
        name: 'Test Plugin',
        description: 'A test plugin',
        version: '1.0.0',
        author: 'Test Author',
      };

      const errors = PluginMetadataParser.validateMetadata(metadata);

      expect(errors).toEqual([]);
    });

    it('should return errors for missing required fields', () => {
      const metadata = {
        name: 'Test Plugin',
      };

      const errors = PluginMetadataParser.validateMetadata(metadata);

      expect(errors).toContain('id is required');
      expect(errors).toContain('description is required');
      expect(errors).toContain('version is required');
    });
  });
});

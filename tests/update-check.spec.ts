/** update-check behavior: semver compare and prompt shape. */
import { describe, expect, it } from 'vitest'
import { compareSemver, updatePrompt, PLUGIN_VERSION } from '../src/client/update-check.ts'

describe('compareSemver', () => {
  it('orders patch/minor/major correctly', () => {
    expect(compareSemver('v0.1.4', 'v0.1.3')).toBeGreaterThan(0)
    expect(compareSemver('v0.2.0', 'v0.1.9')).toBeGreaterThan(0)
    expect(compareSemver('v1.0.0', 'v0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('v0.1.3', 'v0.1.3')).toBe(0)
  })

  it('pads short versions', () => {
    expect(compareSemver('v0.1', 'v0.1.0')).toBe(0)
  })
})

describe('updatePrompt', () => {
  it('mentions the tag and the install command', () => {
    const text = updatePrompt('v0.2.0')
    expect(text).toContain('v0.2.0')
    expect(text).toContain('dsh plugin --profile web add')
  })
})

describe('PLUGIN_VERSION', () => {
  it('is a stable semver string from package.json', () => {
    expect(PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

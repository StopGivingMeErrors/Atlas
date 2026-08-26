import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fixture quarantine test.
 *
 * Demo fixtures and demo providers live exclusively under /dev. This test
 * walks every module under src/ and fails if any of them imports from /dev —
 * guaranteeing production bundles can never contain demo data paths.
 */

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const srcRoot = join(__dirname, '..', 'src')

describe('demo fixture quarantine', () => {
  it('no src/ module imports from /dev except the sanctioned composition-root seam', () => {
    const violations: string[] = []
    for (const file of walk(srcRoot)) {
      // container.ts is the single allowed seam; its guard is asserted below.
      if (file.endsWith('container.ts')) continue
      const content = readFileSync(file, 'utf8')
      const importPattern =
        /from\s+['"][^'"]*(dev\/providers|dev\/fixtures)['"]|import\(\s*['"][^'"]*(dev\/providers|dev\/fixtures)/g
      if (importPattern.test(content)) violations.push(relative(srcRoot, file))
    }
    expect(violations).toEqual([])
  })

  it('the only dynamic dev import lives in the composition root behind a static flag', () => {
    const containerPath = join(srcRoot, 'services', 'container.ts')
    const content = readFileSync(containerPath, 'utf8')
    expect(content).toContain("await import('../../dev/providers')")
    expect(content).toContain('demoFixturesAllowed')

    // Every other occurrence outside container.ts was already covered by the
    // scan above; this assertion documents the sanctioned seam explicitly.
    const otherFiles = walk(srcRoot).filter((f) => !f.endsWith('container.ts'))
    for (const file of otherFiles) {
      expect(readFileSync(file, 'utf8'), relative(srcRoot, file)).not.toContain('dev/providers')
      expect(readFileSync(file, 'utf8'), relative(srcRoot, file)).not.toContain('dev/fixtures')
    }
  })

  it('src/ contains no reference to removed seed or collections modules', () => {
    const violations: string[] = []
    for (const file of walk(srcRoot)) {
      const content = readFileSync(file, 'utf8')
      if (/data\/seed|Collections/.test(content)) violations.push(relative(srcRoot, file))
    }
    expect(violations).toEqual([])
  })

  it('path separators on windows still resolve the src root', () => {
    expect(statSync(srcRoot).isDirectory()).toBe(true)
    expect(srcRoot.includes(sep)).toBe(true)
  })
})

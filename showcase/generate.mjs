#!/usr/bin/env node
// Regenerates cards/{light,dark}/*.svg and the showcase section of README.md.
//
// The public github-readme-stats instance we used to pin repositories with is
// gone (DEPLOYMENT_PAUSED), so the cards are rendered here and committed. Two
// SVGs per repo are emitted and referenced through <picture> so the README
// follows the reader's colour scheme.
//
// Usage: GITHUB_TOKEN=... node showcase/generate.mjs

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const START = '<!-- SHOWCASE:START -->'
const END = '<!-- SHOWCASE:END -->'

const CARD_WIDTH = 420
const CARD_HEIGHT = 120
const PADDING = 16
const DESC_LINES = 2

const THEMES = {
  light: { bg: '#ffffff', border: '#d1d9e0', title: '#0969da', text: '#59636e', icon: '#59636e' },
  dark: { bg: '#0d1117', border: '#3d444d', title: '#4493f8', text: '#9198a1', icon: '#9198a1' },
}

// github/linguist colours for the languages this showcase actually uses.
const LANGUAGE_COLORS = {
  Go: '#00ADD8',
  Rust: '#dea584',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  PHP: '#4F5D95',
  Shell: '#89e051',
  Ruby: '#701516',
  HTML: '#e34c26',
  Python: '#3572A5',
}
const LANGUAGE_FALLBACK = '#8b949e'

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

const ICONS = {
  repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z',
  star: 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z',
  fork: 'M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z',
}

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

// SVG has no text reflow, so widths are estimated. CJK and emoji occupy roughly
// a full em where Latin averages ~0.6em at these sizes.
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff)

const measure = (text, fontSize) => {
  let units = 0
  for (const ch of text) units += isWide(ch.codePointAt(0)) ? 1 : 0.55
  return units * fontSize
}

const truncate = (text, fontSize, maxWidth) => {
  if (measure(text, fontSize) <= maxWidth) return text
  const chars = [...text]
  while (chars.length && measure(chars.join('') + '…', fontSize) > maxWidth) chars.pop()
  return chars.join('') + '…'
}

// Greedy wrap on whitespace, falling back to per-character breaks for CJK runs
// that contain no spaces at all.
const wrap = (text, fontSize, maxWidth, maxLines) => {
  const lines = []
  let line = ''
  const flush = () => {
    if (line) lines.push(line)
    line = ''
  }
  const tokens = text.split(/(\s+)/).filter((t) => t !== '')
  for (const token of tokens) {
    if (lines.length >= maxLines) break
    if (/^\s+$/.test(token)) {
      if (line) line += ' '
      continue
    }
    if (measure(line + token, fontSize) <= maxWidth) {
      line += token
      continue
    }
    if (measure(token, fontSize) <= maxWidth) {
      flush()
      if (lines.length >= maxLines) break
      line = token
      continue
    }
    for (const ch of token) {
      if (measure(line + ch, fontSize) > maxWidth) {
        flush()
        if (lines.length >= maxLines) break
      }
      line += ch
    }
  }
  flush()
  if (lines.length > maxLines) lines.length = maxLines
  const last = lines.length - 1
  if (last >= 0 && lines.join(' ').length < text.length) {
    lines[last] = truncate(lines[last] + '…', fontSize, maxWidth)
  }
  return lines
}

const icon = (path, x, y, fill, size = 16) => {
  const scale = size / 16
  return `<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)})"><path fill="${fill}" d="${path}"/></g>`
}

const renderCard = (repo, theme) => {
  const t = THEMES[theme]
  const inner = CARD_WIDTH - PADDING * 2

  const titleSize = 15
  const titleX = PADDING + 22
  const title = truncate(repo.full_name, titleSize, inner - 22)

  const descSize = 12.5
  const descLines = wrap(repo.description || '', descSize, inner, DESC_LINES)

  const metaY = CARD_HEIGHT - PADDING - 4
  const metaSize = 12

  const parts = []
  parts.push(
    `<rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>`
  )
  parts.push(icon(ICONS.repo, PADDING, PADDING + 1, t.icon))
  parts.push(
    `<text x="${titleX}" y="${PADDING + 13}" font-family="${FONT}" font-size="${titleSize}" font-weight="600" fill="${t.title}">${escape(title)}</text>`
  )
  descLines.forEach((line, i) => {
    parts.push(
      `<text x="${PADDING}" y="${PADDING + 38 + i * 18}" font-family="${FONT}" font-size="${descSize}" fill="${t.text}">${escape(line)}</text>`
    )
  })

  let x = PADDING
  if (repo.language) {
    const color = LANGUAGE_COLORS[repo.language] || LANGUAGE_FALLBACK
    parts.push(`<circle cx="${x + 6}" cy="${metaY - 4}" r="6" fill="${color}"/>`)
    x += 18
    parts.push(
      `<text x="${x}" y="${metaY}" font-family="${FONT}" font-size="${metaSize}" fill="${t.text}">${escape(repo.language)}</text>`
    )
    x += measure(repo.language, metaSize) + 20
  }
  for (const [path, value] of [
    [ICONS.star, repo.stargazers_count],
    [ICONS.fork, repo.forks_count],
  ]) {
    parts.push(icon(path, x, metaY - 12, t.icon, 14))
    x += 18
    const label = String(value)
    parts.push(
      `<text x="${x}" y="${metaY}" font-family="${FONT}" font-size="${metaSize}" fill="${t.text}">${label}</text>`
    )
    x += measure(label, metaSize) + 20
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escape(repo.full_name)}">
<title>${escape(repo.full_name)}${repo.description ? ' — ' + escape(repo.description) : ''}</title>
${parts.join('\n')}
</svg>
`
}

const slug = (fullName) => fullName.replace('/', '__')

const fetchRepo = async (fullName) => {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'mpyw-showcase' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers })
  if (!res.ok) throw new Error(`GET /repos/${fullName} -> ${res.status} ${await res.text()}`)
  const r = await res.json()
  if (r.private) throw new Error(`${fullName} is private`)
  if (r.archived) throw new Error(`${fullName} is archived — drop it from showcase/config.json`)
  if (r.full_name !== fullName) {
    console.warn(`  note: ${fullName} now resolves to ${r.full_name}`)
  }
  return r
}

const main = async () => {
  const config = JSON.parse(await readFile(resolve(ROOT, 'showcase/config.json'), 'utf8'))

  const groups = []
  const keep = new Set()
  for (const group of config.groups) {
    const repos = []
    for (const fullName of group.repos) {
      const repo = await fetchRepo(fullName)
      repos.push(repo)
      keep.add(`${slug(repo.full_name)}.svg`)
      for (const theme of Object.keys(THEMES)) {
        await mkdir(resolve(ROOT, 'cards', theme), { recursive: true })
        await writeFile(resolve(ROOT, 'cards', theme, `${slug(repo.full_name)}.svg`), renderCard(repo, theme))
      }
      console.log(`  ${repo.full_name} (${repo.stargazers_count}★)`)
    }
    groups.push({ title: group.title, repos })
  }

  // Drop cards for repositories that have left the config.
  for (const theme of Object.keys(THEMES)) {
    const dir = resolve(ROOT, 'cards', theme)
    for (const name of await readdir(dir)) {
      if (!keep.has(name)) {
        await rm(resolve(dir, name))
        console.log(`  removed stale cards/${theme}/${name}`)
      }
    }
  }

  const sections = groups.map((group) => {
    const cards = group.repos
      .map((repo) => {
        const file = `${slug(repo.full_name)}.svg`
        return [
          `<a href="${repo.html_url}">`,
          `  <picture>`,
          `    <source media="(prefers-color-scheme: dark)" srcset="cards/dark/${file}">`,
          `    <img src="cards/light/${file}" width="${CARD_WIDTH}" alt="${escape(repo.full_name)}">`,
          `  </picture>`,
          `</a>`,
        ].join('\n')
      })
      .join('\n')
    return `## ${group.title}\n\n${cards}\n`
  })

  const body = [
    START,
    '<!-- Generated by showcase/generate.mjs — do not edit by hand. -->',
    '',
    ...sections,
    'More introduced in [Repositories](https://github.com/mpyw?tab=repositories).',
    '',
    END,
  ].join('\n')

  const readmePath = resolve(ROOT, 'README.md')
  const readme = await readFile(readmePath, 'utf8')
  const from = readme.indexOf(START)
  const to = readme.indexOf(END)
  if (from === -1 || to === -1) throw new Error(`README.md is missing the ${START} / ${END} markers`)
  await writeFile(readmePath, readme.slice(0, from) + body + readme.slice(to + END.length))
  console.log('README.md showcase section updated')
}

await main()

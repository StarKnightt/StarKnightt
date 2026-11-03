// Redraws the profile: terminal SVGs, the daily horizon, and the build gallery in README.md.
// No dependencies. Run from the repo root: node .github/scripts/profile/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('./builds.json', import.meta.url), 'utf8'));
const today = process.env.PROFILE_DATE || new Date().toISOString().slice(0, 10);

// ---------- data ----------

async function fetchRepos(user) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'profile-builder' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/users/${user}/repos?type=owner&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return new Map(repos.filter(r => !r.fork && !r.private).map(r => [r.name, r]));
}

const repos = await fetchRepos(cfg.user);
const need = name => {
  const r = repos.get(name);
  if (!r) throw new Error(`repo not found: ${name}`);
  return r;
};

const BUILD_TOPICS = ['threejs', 'three-js', 'webgl', 'webgpu', 'react-three-fiber', 'game'];
const latest = [...repos.values()]
  .filter(r => r.topics?.some(t => BUILD_TOPICS.includes(t)))
  .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

// Everything made here, forks/archives and the profile repo itself left out.
const top = [...repos.values()]
  .filter(r => !r.archived && r.name !== cfg.user && r.name !== '.github')
  .sort((a, b) => b.stargazers_count - a.stargazers_count)
  .slice(0, cfg.top);

const avatar = readFileSync(new URL('./avatar.txt', import.meta.url), 'utf8').trimEnd().split(/\r?\n/).map(l => l.trimEnd());

function ago(iso) {
  const days = Math.round((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function age(born) {
  const [by, bm, bd] = born.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// ---------- terminal ----------

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const THEMES = {
  dark: { bg: '#0b0f14', bar: '#11161d', border: '#262c36', fg: '#d1d7e0', dim: '#7d8590', user: '#7ee787', path: '#79c0ff', star: '#e3b341', accent: '#ffa657' },
  light: { bg: '#fbfcfd', bar: '#f0f2f5', border: '#d1d9e0', fg: '#1f2328', dim: '#6e7781', user: '#1a7f37', path: '#0969da', star: '#9a6700', accent: '#bc4c00' },
};

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const padL = (s, n) => ' '.repeat(Math.max(0, n - s.length)) + s;

const cmd = text => ({ cmd: true, segs: [['prasen@dev', 'user'], [' ~ ', 'path'], ['$ ', 'dim'], [text, 'fg']] });
const out = (...segs) => ({ cmd: false, segs });

const lines = [
  cmd('whoami'),
  out([`prasenjit. ${age(cfg.born)}. full-stack dev, building in public.`, 'fg']),
  out(['i make cool stuff for the web and run a 500+ dev community.', 'fg']),
  cmd(`ls ~/projects --sort=stars | head -${cfg.top}`),
  ...top.map(r => out([pad(r.name, 25), 'fg'], ['★ ', 'star'], [padL(String(r.stargazers_count), 4), 'star'])),
  ...(latest ? [cmd('ls -t ~/builds | head -1'), out([pad(latest.name, 25), 'accent'], [`shipped ${ago(latest.created_at)}`, 'dim'])] : []),
  cmd('cat ~/rules.txt'),
  out(['no asset packs. every mesh, texture and sound is code.', 'fg']),
  cmd(''),
];

const W = 860, PADX = 24, BAR = 38, LH = 23, FS = 14, CW = 8.4;
const H = BAR + 18 + lines.length * LH + 10;
// ASCII portrait column on the right, sized to the text block's height.
const ART_ROWS = avatar.length, ART_COLS = Math.max(...avatar.map(l => l.length));
// avatar.py samples a square image into 46x26 cells, so a cell is 26/46 as wide as it is tall.
const ALH = (lines.length * LH - 4) / ART_ROWS, ACW = ALH * (26 / 46), AFS = ALH * 0.98;
const AX = W - PADX - ART_COLS * ACW, AY = BAR + 18;
const FONT = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;

// Timeline in ms: commands type out one character at a time, output lands line by line.
const TYPE = 48, AFTER_CMD = 380, OUT_GAP = 70, HOLD = 9000, START = 600;
let t = START;
const timeline = lines.map(line => {
  const promptLen = line.segs.slice(0, 3).reduce((n, [s]) => n + s.length, 0);
  const total = line.segs.reduce((n, [s]) => n + s.length, 0);
  const steps = [];
  if (line.cmd) {
    steps.push([t, promptLen]);
    for (let i = 1; i <= total - promptLen; i++) steps.push([t + i * TYPE, promptLen + i]);
    t += (total - promptLen) * TYPE + AFTER_CMD;
  } else {
    steps.push([t, total]);
    t += OUT_GAP;
  }
  return steps;
});
const CYCLE = t + HOLD;

function keyTimes(times) {
  // Discrete SMIL keyTimes: start at 0, strictly increasing.
  const ks = [0, ...times.map(ms => ms / CYCLE)];
  return ks.map((k, i) => (i === 0 ? 0 : Math.max(k, ks[i - 1] + 1e-5)).toFixed(5)).join(';');
}

function terminalSvg(theme) {
  const c = THEMES[theme];
  const full = W;
  const clips = [], texts = [];
  lines.forEach((line, i) => {
    const y = BAR + 18 + i * LH + FS;
    const steps = timeline[i];
    const widths = ['0', ...steps.map(([, n], j) => (j === steps.length - 1 ? full : PADX + n * CW + 1).toFixed(1))];
    clips.push(`<clipPath id="l${i}"><rect x="0" y="${y - FS - 3}" height="${LH}" width="0"><animate attributeName="width" calcMode="discrete" dur="${CYCLE}ms" repeatCount="indefinite" values="${widths.join(';')}" keyTimes="${keyTimes(steps.map(([ms]) => ms))}"/></rect></clipPath>`);
    let col = 0;
    const parts = line.segs.filter(([s]) => s.length).map(([s, role]) => {
      const x = PADX + col * CW;
      col += s.length;
      return `<text x="${x.toFixed(1)}" y="${y}" fill="${c[role]}" textLength="${(s.length * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(s)}</text>`;
    });
    texts.push(`<g clip-path="url(#l${i})">${parts.join('')}</g>`);
  });

  // Block cursor: hops to wherever the last character landed, blinks on its own clock.
  const stops = timeline.flatMap((steps, i) => steps.map(([ms, n]) => [ms, PADX + n * CW + 1, BAR + 18 + i * LH]));
  const cx = ['-20', ...stops.map(([, x]) => x.toFixed(1))].join(';');
  const cy = [String(BAR + 18), ...stops.map(([, , y]) => y)].join(';');
  const kt = keyTimes(stops.map(([ms]) => ms));
  const cursor = `<rect width="${CW}" height="${FS + 3}" fill="${c.fg}" opacity="0.85">
    <animate attributeName="x" calcMode="discrete" dur="${CYCLE}ms" repeatCount="indefinite" values="${cx}" keyTimes="${kt}"/>
    <animate attributeName="y" calcMode="discrete" dur="${CYCLE}ms" repeatCount="indefinite" values="${cy}" keyTimes="${kt}"/>
    <animate attributeName="fill-opacity" calcMode="discrete" dur="1.06s" repeatCount="indefinite" values="1;0" keyTimes="0;0.5"/>
  </rect>`;

  // The portrait prints top to bottom right after `whoami` answers.
  const artStart = timeline[1][0][0];
  const art = avatar.map((row, i) => {
    const lead = row.length - row.trimStart().length, s = row.trim();
    if (!s) return '';
    const at = (artStart + i * 28) / CYCLE;
    return `<text x="${(AX + lead * ACW).toFixed(1)}" y="${(AY + (i + 1) * ALH - ALH * 0.2).toFixed(1)}" textLength="${(s.length * ACW).toFixed(1)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve" opacity="0">${esc(s)}<animate attributeName="opacity" calcMode="discrete" dur="${CYCLE}ms" repeatCount="indefinite" values="0;1" keyTimes="0;${at.toFixed(5)}"/></text>`;
  }).join('');

  const dots = ['#ff5f57', '#febc2e', '#28c840'].map((f, i) => `<circle cx="${22 + i * 20}" cy="${BAR / 2}" r="6" fill="${f}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="terminal: prasenjit builds small worlds that run in a browser tab">
<defs>${clips.join('')}<clipPath id="win"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
<g clip-path="url(#win)">
<rect width="${W}" height="${H}" fill="${c.bg}"/>
<rect width="${W}" height="${BAR}" fill="${c.bar}"/>
<line x1="0" y1="${BAR}" x2="${W}" y2="${BAR}" stroke="${c.border}"/>
${dots}
<text x="${W / 2}" y="${BAR / 2 + 4.5}" fill="${c.dim}" font-family="${FONT}" font-size="12.5" text-anchor="middle">prasen@dev: ~</text>
<g font-family="${FONT}" font-size="${AFS.toFixed(2)}" fill="${c.dim}">${art}</g>
<g font-family="${FONT}" font-size="${FS}">${texts.join('\n')}</g>
${cursor}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="11.5" fill="none" stroke="${c.border}"/>
</svg>
`;
}

// ---------- horizon ----------

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOODS = {
  dawn:   { sky: ['#22304f', '#8a6b8e', '#f2a97e', '#ffd9a8'], sun: '#fff1d6', land: '#2a2a3d', haze: '#f0b996' },
  golden: { sky: ['#3d6491', '#8fa7c0', '#f4c27f', '#ffe2a6'], sun: '#fff4dc', land: '#3b2f2a', haze: '#f2c48c' },
  dusk:   { sky: ['#171533', '#4b2f63', '#b4537a', '#f39062'], sun: '#ffd7a8', land: '#1d1526', haze: '#c96a72' },
  night:  { sky: ['#03050c', '#0a1124', '#16244a', '#2b3d6b'], sun: '#e9eefc', land: '#05070d', haze: '#2d406c' },
};

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');

function horizonSvg(date) {
  const seed = Number(date.replace(/-/g, ''));
  const rnd = mulberry32(seed);
  const moodName = Object.keys(MOODS)[Math.floor(rnd() * 4)];
  const m = MOODS[moodName];
  const HW = 860, HH = 170;

  // 1D value noise, a few octaves.
  const lattice = Array.from({ length: 512 }, rnd);
  const vnoise = x => {
    const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
    return lattice[i & 511] * (1 - s) + lattice[(i + 1) & 511] * s;
  };
  const fbm = x => vnoise(x) * 0.6 + vnoise(x * 2.1 + 17) * 0.27 + vnoise(x * 4.3 + 41) * 0.13;

  const sunX = HW * (0.18 + rnd() * 0.64);
  const sunY = moodName === 'night' ? 34 + rnd() * 30 : 92 + rnd() * 22;
  const sunR = moodName === 'night' ? 11 : 18 + rnd() * 8;

  const layers = 5, ridges = [];
  for (let L = 0; L < layers; L++) {
    const depth = L / (layers - 1);                   // 0 = farthest
    const base = 104 + depth * 46;
    const amp = 30 - depth * 12;
    const freq = 0.004 + depth * 0.006;
    const off = rnd() * 300;
    let d = `M0 ${HH}`;
    for (let x = 0; x <= HW; x += 5) d += ` L${x} ${(base - amp * fbm(x * freq + off)).toFixed(1)}`;
    d += ` L${HW} ${HH} Z`;
    ridges.push(`<path d="${d}" fill="${mix(m.haze, m.land, 0.22 + depth * 0.78)}"/>`);
    // Mist drifts in the valleys behind the 2nd and 4th ridge.
    if (L === 1 || L === 3) {
      const my = base + 4, mx = HW * (0.2 + rnd() * 0.6), sway = 40 + rnd() * 40, dur = 38 + rnd() * 30;
      ridges.push(`<ellipse cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" rx="${(260 + rnd() * 160).toFixed(0)}" ry="9" fill="url(#mist)"><animateTransform attributeName="transform" type="translate" values="${-sway} 0;${sway} 0;${-sway} 0" dur="${dur.toFixed(1)}s" repeatCount="indefinite"/></ellipse>`);
    }
  }

  // Everything below moves slowly; SMIL keeps it working inside GitHub's <img>.
  const r1 = n => n.toFixed(1);
  let extras = '';
  if (moodName === 'night') {
    for (let i = 0; i < 70; i++) {
      const x = rnd() * HW, y = rnd() * 100, r = 0.4 + rnd() * 0.9, o = 0.35 + rnd() * 0.6;
      const twinkle = rnd() < 0.4
        ? `<animate attributeName="opacity" values="${o.toFixed(2)};0.12;${o.toFixed(2)}" dur="${r1(2 + rnd() * 4)}s" begin="-${r1(rnd() * 6)}s" repeatCount="indefinite"/>`
        : '';
      extras += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r.toFixed(2)}" fill="#fff" opacity="${o.toFixed(2)}">${twinkle}</circle>`;
    }
    // A shooting star crosses once every ~15s.
    const sx = HW * (0.2 + rnd() * 0.5), sy = 12 + rnd() * 25;
    extras += `<g opacity="0"><line x1="${r1(sx)}" y1="${r1(sy)}" x2="${r1(sx - 46)}" y2="${r1(sy - 14)}" stroke="url(#trail)" stroke-width="1.3" stroke-linecap="round"/>
<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.78;0.8;0.86;1" dur="15s" repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate" values="0 0;0 0;150 46;150 46" keyTimes="0;0.78;0.86;1" dur="15s" repeatCount="indefinite"/></g>`;
  } else {
    // A loose flock drifts across the sky, wings flapping out of step.
    const n = 3 + Math.floor(rnd() * 3), by = 26 + rnd() * 30, cross = 70 + rnd() * 40, phase = rnd() * cross;
    const ink = mix(m.land, m.sky[1], 0.25);
    for (let i = 0; i < n; i++) {
      const ox = (rnd() - 0.5) * 70, oy = (rnd() - 0.5) * 20, s = 3 + rnd() * 2.5, flap = 0.7 + rnd() * 0.5;
      const up = `M${r1(-s)} ${r1(-s * 0.6)} Q${r1(-s * 0.4)} ${r1(-s)} 0 0 Q${r1(s * 0.4)} ${r1(-s)} ${r1(s)} ${r1(-s * 0.6)}`;
      const down = `M${r1(-s)} ${r1(s * 0.3)} Q${r1(-s * 0.4)} ${r1(-s * 0.2)} 0 0 Q${r1(s * 0.4)} ${r1(-s * 0.2)} ${r1(s)} ${r1(s * 0.3)}`;
      extras += `<g><animateTransform attributeName="transform" type="translate" values="${r1(-60 + ox)} ${r1(by + oy)};${r1(HW + 60 + ox)} ${r1(by + oy - 10)}" dur="${r1(cross)}s" begin="-${r1(phase)}s" repeatCount="indefinite"/>
<path d="${up}" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"><animate attributeName="d" values="${up};${down};${up}" dur="${flap.toFixed(2)}s" begin="-${r1(rnd())}s" repeatCount="indefinite"/></path></g>`;
    }
  }

  const label = `${date} · ${moodName} · seed ${seed}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" role="img" aria-label="a horizon drawn from today's date: ${moodName}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${m.sky.map((s, i) => `<stop offset="${(i / 3) * 0.78}" stop-color="${s}"/>`).join('')}</linearGradient>
<radialGradient id="glow" cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR * 7}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${m.sun}" stop-opacity="0.55"/><stop offset="1" stop-color="${m.sun}" stop-opacity="0"/></radialGradient>
<radialGradient id="mist"><stop offset="0" stop-color="${m.haze}" stop-opacity="0.55"/><stop offset="1" stop-color="${m.haze}" stop-opacity="0"/></radialGradient>
<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="frame"><rect width="${HW}" height="${HH}" rx="12"/></clipPath>
</defs>
<g clip-path="url(#frame)">
<rect width="${HW}" height="${HH}" fill="url(#sky)"/>
${extras}
<rect width="${HW}" height="${HH}" fill="url(#glow)"><animate attributeName="opacity" values="0.8;1;0.8" dur="8s" repeatCount="indefinite"/></rect>
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${m.sun}"/>
${ridges.join('\n')}
<text x="16" y="${HH - 14}" font-family="${FONT}" font-size="10.5" fill="#fff" fill-opacity="0.5">${label}</text>
</g>
</svg>
`;
}

// ---------- write ----------

mkdirSync('assets', { recursive: true });
writeFileSync('assets/terminal-dark.svg', terminalSvg('dark'));
writeFileSync('assets/terminal-light.svg', terminalSvg('light'));
writeFileSync('assets/horizon.svg', horizonSvg(today));

console.log(`[profile] ${today} · top: ${top.map(r => r.name).join(', ')} · latest build: ${latest?.name ?? 'none'} · terminal cycle ${(CYCLE / 1000).toFixed(1)}s`);

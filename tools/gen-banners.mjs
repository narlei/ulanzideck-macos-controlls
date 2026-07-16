#!/usr/bin/env node
// Store art generator (cover + 2 banners) for macOS Controls.
// Key mockups are rendered by the plugin's own SVG renderer (app.js), so the
// art always matches what the deck actually shows.
//
// Run:  node tools/gen-banners.mjs        (writes resources/*.svg)
// Then: rasterize with Chrome headless — see tools/render-banners.sh
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

process.env.MACCTRL_NO_CONNECT = '1';
const { idleSvg, countdownSvg, firingSvg } = await import(
  '../com.narlei.macoscontrolls.ulanziPlugin/app.js'
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../resources');
const ICON_PATH = path.resolve(
  __dirname,
  '../com.narlei.macoscontrolls.ulanziPlugin/icons/plugin.svg'
);

// ---- palette / shared ---------------------------------------------------------
const BG0 = '#0a0e1a';
const BG1 = '#0d1117';
const WHITE = '#ffffff';
const MUTED = '#8b93a7';
const CARD = '#15181f';
const CARD_BORDER = 'rgba(255,255,255,0.07)';
const KEY_BG = '#0e0e12';

let uid = 0;
const nextId = () => `id${uid++}`;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const svgDataUrl = (s) =>
  `data:image/svg+xml;base64,${Buffer.from(s, 'utf8').toString('base64')}`;

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function txt(s, x, y, size, { fill = WHITE, weight = 700, anchor = 'start', spacing = 0 } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : '';
  return `<text x="${x}" y="${y}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${esc(s)}</text>`;
}

function bgLayer(w, h) {
  const g = nextId();
  const glow = nextId();
  return (
    `<defs>` +
    `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BG0}"/><stop offset="1" stop-color="${BG1}"/></linearGradient>` +
    `<radialGradient id="${glow}" cx="0.14" cy="0.1" r="0.5"><stop offset="0" stop-color="rgba(46,86,170,0.38)"/><stop offset="1" stop-color="rgba(46,86,170,0)"/></radialGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${g})"/>` +
    `<rect width="${w}" height="${h}" fill="url(#${glow})"/>`
  );
}

const headlineGradientDef = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3ecf6b"/><stop offset="0.55" stop-color="#22d3ee"/><stop offset="1" stop-color="#4772fa"/></linearGradient>`;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

// A real plugin key render placed at x,y (the render carries its own rounded bg).
function keyImage(renderedSvg, x, y, size) {
  return `<image href="${svgDataUrl(renderedSvg)}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}

function emptyKey(x, y, size) {
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${KEY_BG}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
}

function checkItem(x, y, label, size, accent) {
  const box = size * 1.1;
  const by = y - box * 0.75;
  return (
    `<rect x="${x}" y="${by}" width="${box}" height="${box}" rx="${box * 0.28}" fill="${hexToRgba(accent, 0.14)}" stroke="${accent}" stroke-width="2"/>` +
    `<path d="M ${x + box * 0.25} ${by + box * 0.52} L ${x + box * 0.44} ${by + box * 0.7} L ${x + box * 0.76} ${by + box * 0.3}" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    txt(label, x + box + size * 0.5, y, size, { fill: '#e6e9f0', weight: 600 })
  );
}

function pillRow(x, y, labels, size = 28, gap = 18) {
  let cx = x;
  let out = '';
  for (const l of labels) {
    const padX = Math.round(size * 0.9);
    const w = Math.round(l.length * size * 0.56 + padX * 2);
    const h = Math.round(size * 1.9);
    out +=
      `<rect x="${cx}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>` +
      txt(l, cx + w / 2, y + h / 2 + size * 0.34, size, { fill: '#d3d8e3', weight: 600, anchor: 'middle' });
    cx += w + gap;
  }
  return out;
}

function appIcon(x, y, size) {
  const iconUrl = svgDataUrl(readFileSync(ICON_PATH, 'utf8'));
  const glow = nextId();
  return (
    `<defs><filter id="${glow}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="18"/></filter></defs>` +
    `<rect x="${x - 4}" y="${y - 4}" width="${size + 8}" height="${size + 8}" rx="${size * 0.28}" filter="url(#${glow})" fill="#4772fa" opacity="0.55"/>` +
    `<image href="${iconUrl}" x="${x}" y="${y}" width="${size}" height="${size}"/>`
  );
}

// ---- cover 1600×800 -----------------------------------------------------------
function buildCover() {
  const W = 1600;
  const H = 800;
  const gid = nextId();
  let s = bgLayer(W, H);
  s += `<defs>${headlineGradientDef(gid)}</defs>`;
  s += appIcon(90, 150, 120);
  s += txt('macOS Controls', 240, 210, 60, { weight: 800 });
  s += txt('UlanziDeck · macOS', 242, 250, 26, { fill: MUTED, weight: 600 });
  s += txt('Control your Mac.', 90, 400, 88, { weight: 800 });
  s += txt('From your deck.', 90, 500, 88, { weight: 800, fill: `url(#${gid})` });
  s += txt('Five system actions with tap-to-cancel safety.', 92, 560, 32, { fill: '#aeb6c6', weight: 500 });
  s += pillRow(90, 610, ['5 actions', 'Tap to cancel', 'Instant lock'], 28, 18);

  // Deck panel: real key renders for all five actions + empty keys.
  const px = 900;
  const py = 190;
  const pw = 610;
  const ph = 430;
  s += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="34" fill="#141414" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
  s += txt('U · STUDIO', px + pw / 2, py + 60, 26, { fill: '#6b7180', weight: 700, anchor: 'middle', spacing: 8 });
  const key = 116;
  const gap = 22;
  const gx = px + 40;
  const gy = py + 90;
  const row1 = ['sleep', 'restart', 'shutdown', 'trash'].map((k) => idleSvg(k, 5));
  row1.forEach((r, i) => (s += keyImage(r, gx + i * (key + gap), gy, key)));
  s += keyImage(idleSvg('lock', 5), gx, gy + key + gap, key);
  for (let i = 1; i < 4; i++) s += emptyKey(gx + i * (key + gap), gy + key + gap, key);
  return svg(W, H, s);
}

// ---- banner 1 (2400×1600): the five actions -----------------------------------
function buildBanner1() {
  const W = 2400;
  const H = 1600;
  const gid = nextId();
  const accent = '#3ecf6b';
  let s = bgLayer(W, H);
  s += `<defs>${headlineGradientDef(gid)}</defs>`;
  const lx = 130;
  s += `<circle cx="${lx + 8}" cy="335" r="9" fill="${accent}"/>`;
  s += txt('FIVE SYSTEM ACTIONS', lx + 34, 345, 32, { fill: '#9aa2b4', weight: 700, spacing: 6 });
  s += txt('Five actions.', lx, 500, 118, { weight: 800 });
  s += txt('Now with Lock.', lx, 630, 118, { weight: 800, fill: `url(#${gid})` });
  s += txt('Sleep, restart, shut down, empty the Trash', lx, 770, 42, { fill: '#aeb6c6', weight: 500 });
  s += txt('and lock your screen — straight from a key.', lx, 828, 42, { fill: '#aeb6c6', weight: 500 });
  [
    'Lock Screen & Empty Trash fire instantly',
    'Countdown on sleep, restart & shutdown',
    'Sharp vector art on every key state',
  ].forEach((c, i) => (s += checkItem(lx, 1130 + i * 100, c, 40, accent)));

  const cards = [
    { render: idleSvg('sleep', 5), title: 'Sleep', sub: 'countdown', accent: '#4F8DF7' },
    { render: idleSvg('restart', 5), title: 'Restart', sub: 'countdown', accent: '#F5A623' },
    { render: idleSvg('shutdown', 5), title: 'Shutdown', sub: 'countdown', accent: '#F25555' },
    { render: idleSvg('trash', 5), title: 'Empty Trash', sub: 'instant', accent: '#2DD4BF' },
    { render: idleSvg('lock', 5), title: 'Lock Screen', sub: 'instant · new', accent: '#A78BFA' },
    { render: countdownSvg('sleep', 3.2, 5), title: 'Countdown', sub: 'tap to cancel', accent: '#4F8DF7' },
  ];
  const cols = 3;
  const cw = 360;
  const ch = 500;
  const gapx = 44;
  const gapy = 60;
  const x0 = 1120;
  const y0 = 300;
  cards.forEach((c, i) => {
    const cx = x0 + (i % cols) * (cw + gapx);
    const cy = y0 + Math.floor(i / cols) * (ch + gapy);
    s += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="30" fill="${CARD}" stroke="${CARD_BORDER}" stroke-width="1"/>`;
    s += `<rect x="${cx + 24}" y="${cy}" width="${cw - 48}" height="6" rx="3" fill="${c.accent}"/>`;
    const bsize = 236;
    s += keyImage(c.render, cx + (cw - bsize) / 2, cy + 46, bsize);
    s += txt(c.title, cx + cw / 2, cy + 380, 40, { weight: 800, anchor: 'middle' });
    s += txt(c.sub, cx + cw / 2, cy + 428, 30, { fill: MUTED, weight: 600, anchor: 'middle' });
  });
  return svg(W, H, s);
}

// ---- banner 2 (2400×1600): tap-to-cancel countdown ------------------------------
function buildBanner2() {
  const W = 2400;
  const H = 1600;
  const gid = nextId();
  const accent = '#22d3ee';
  let s = bgLayer(W, H);
  s += `<defs>${headlineGradientDef(gid)}</defs>`;
  const lx = 130;
  s += `<circle cx="${lx + 8}" cy="335" r="9" fill="${accent}"/>`;
  s += txt('TAP-TO-CANCEL SAFETY', lx + 34, 345, 32, { fill: '#9aa2b4', weight: 700, spacing: 6 });
  s += txt('Nothing fires', lx, 500, 118, { weight: 800 });
  s += txt('by accident.', lx, 630, 118, { weight: 800, fill: `url(#${gid})` });
  s += txt('Power actions arm a visible countdown on the', lx, 770, 42, { fill: '#aeb6c6', weight: 500 });
  s += txt('key itself. Tap again to cancel. That’s it.', lx, 828, 42, { fill: '#aeb6c6', weight: 500 });
  [
    'Pick 5, 10 or 30 seconds per key',
    'Progress ring drains in real time',
    'One more tap cancels instantly',
  ].forEach((c, i) => (s += checkItem(lx, 1130 + i * 100, c, 40, accent)));

  // Idle → counting → firing, using the real shutdown renders.
  const stages = [
    { render: idleSvg('shutdown', 5), title: '1 · Tap', sub: 'armed & ready' },
    { render: countdownSvg('shutdown', 3.2, 5), title: '2 · Countdown', sub: 'tap again to cancel' },
    { render: firingSvg('shutdown'), title: '3 · Fires', sub: 'only if you let it' },
  ];
  const cw = 340;
  const ch = 490;
  const gap = 65;
  const x0 = 1130;
  const cy = 520;
  stages.forEach((st, i) => {
    const cx = x0 + i * (cw + gap);
    s += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="30" fill="${CARD}" stroke="${CARD_BORDER}" stroke-width="1"/>`;
    s += `<rect x="${cx + 24}" y="${cy}" width="${cw - 48}" height="6" rx="3" fill="#F25555"/>`;
    const bsize = 280;
    s += keyImage(st.render, cx + (cw - bsize) / 2, cy + 40, bsize);
    s += txt(st.title, cx + cw / 2, cy + 390, 40, { weight: 800, anchor: 'middle' });
    s += txt(st.sub, cx + cw / 2, cy + 438, 30, { fill: MUTED, weight: 600, anchor: 'middle' });
    if (i < stages.length - 1) {
      const ax = cx + cw + gap / 2;
      s += `<path d="M ${ax - 12} ${cy + ch / 2 - 22} l 24 22 l -24 22" fill="none" stroke="#5b6272" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  });
  return svg(W, H, s);
}

// ---- write ----------------------------------------------------------------------
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'cover.svg'), buildCover());
writeFileSync(path.join(OUT, 'banner1.svg'), buildBanner1());
writeFileSync(path.join(OUT, 'banner2.svg'), buildBanner2());
console.log('wrote cover.svg, banner1.svg, banner2.svg →', OUT);

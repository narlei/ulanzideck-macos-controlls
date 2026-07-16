// macOS Controlls — Ulanzi Deck plugin (Node.js main service)
// Three actions (Sleep / Restart / Shutdown). Each key press starts a countdown
// (5,4,3,2,1 ...) showing "toque para cancelar"; pressing again cancels. When the
// countdown reaches zero the matching macOS command runs. The countdown length is
// configurable per button (5 / 10 / 30 seconds) from the Property Inspector.

import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import UlanziApi from './sdk/ulanziApi.js';

const PLUGIN_UUID = 'com.narlei.macoscontrolls.controls';
const DEFAULT_DURATION = 5;
const ALLOWED_DURATIONS = [5, 10, 30];

// "tap to cancel" shown on the key during a countdown. English is the default;
// applyLocale() swaps it for the host language using the <lang>.json files at
// the plugin root (same convention the Property Inspector uses).
let CANCEL_LINES = ['tap to', 'cancel'];

function applyLocale(lang) {
  try {
    const raw = readFileSync(new URL(`./${lang}.json`, import.meta.url), 'utf8');
    const loc = JSON.parse(raw).Localization || {};
    if (loc.cancelLine1 && loc.cancelLine2) {
      CANCEL_LINES = [loc.cancelLine1, loc.cancelLine2];
    }
  } catch {
    // No file for this language — keep the English default.
  }
}

// Per-operation config. `cmd` runs via /bin/sh (no sudo needed):
//  - sleep    -> pmset requests an immediate sleep
//  - restart  -> System Events performs a graceful restart
//  - shutdown -> System Events performs a graceful shutdown
const OPS = {
  sleep: {
    label: 'SLEEP',
    firing: 'SLEEPING',
    color: '#4F8DF7',
    colorSoft: '#8FB8FF',
    bgTop: '#1B2B4A',
    bgBottom: '#0A1120',
    fireTop: '#3B82F6',
    fireBottom: '#1E45B8',
    cmd: 'pmset sleepnow',
  },
  restart: {
    label: 'RESTART',
    firing: 'RESTARTING',
    color: '#F5A623',
    colorSoft: '#FCCB5F',
    bgTop: '#33260A',
    bgBottom: '#140E02',
    fireTop: '#F59E0B',
    fireBottom: '#A85E06',
    cmd: "osascript -e 'tell application \"System Events\" to restart'",
  },
  shutdown: {
    label: 'SHUTDOWN',
    firing: 'SHUTTING DOWN',
    color: '#F25555',
    colorSoft: '#FF8F8F',
    bgTop: '#3A1212',
    bgBottom: '#160404',
    fireTop: '#EF4444',
    fireBottom: '#9E1C1C',
    cmd: "osascript -e 'tell application \"System Events\" to shut down'",
  },
  // Empty Trash fires immediately on tap (no countdown). Finder's "warn before
  // emptying" flag is turned off first so the Trash is emptied silently, with no
  // system confirmation dialog. This also empties the Trash on mounted volumes.
  trash: {
    label: 'EMPTY TRASH',
    firing: 'EMPTIED',
    color: '#2DD4BF',
    colorSoft: '#7FE9DC',
    bgTop: '#0E332F',
    bgBottom: '#04140F',
    fireTop: '#14B8A6',
    fireBottom: '#0B6B60',
    cmd: "osascript -e 'tell application \"Finder\" to set warns before emptying of trash to false' -e 'tell application \"Finder\" to empty trash'",
    noCountdown: true,
  },
  // Lock Screen fires immediately on tap. Preferred path is the native lock
  // shortcut (Ctrl+Cmd+Q) sent via System Events, which shows the real lock
  // screen but needs the Accessibility permission; if that is denied the
  // fallback sleeps the display, which locks per the user's "require password"
  // setting (immediate by default on modern macOS).
  lock: {
    label: 'LOCK',
    firing: 'LOCKED',
    color: '#A78BFA',
    colorSoft: '#C9BAFF',
    bgTop: '#251B4D',
    bgBottom: '#0B071E',
    fireTop: '#8B5CF6',
    fireBottom: '#4B2AA6',
    cmd: "osascript -e 'tell application \"System Events\" to keystroke \"q\" using {command down, control down}' || pmset displaysleepnow",
    noCountdown: true,
  },
};

const $UD = new UlanziApi();
const INSTANCES = {};

function log(...args) {
  console.log('[macOS Controlls]', ...args);
}

// Resolve the operation key from an action UUID (last segment). Falls back to the
// safest option (sleep) if the UUID is somehow unexpected.
function opKeyFromUuid(uuid) {
  const seg = String(uuid || '').split('.').pop();
  return OPS[seg] ? seg : 'sleep';
}

function opKeyFromContext(context) {
  try {
    return opKeyFromUuid($UD.decodeContext(context).uuid);
  } catch {
    return 'sleep';
  }
}

// ---------------------------------------------------------------------------
// SVG rendering (plain strings -> base64 data URI). No DOM / svgdom needed.
// ---------------------------------------------------------------------------

const SIZE = 200;
const RING_R = 78;

function svgToIcon(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The device SVG renderer ignores `dominant-baseline`, so `y` is treated as the
// text baseline. To visually center text at a point cy we place the baseline at
// cy + ~0.36 * fontSize (roughly half the cap height).
function centeredBaseline(cy, fontSize) {
  return (cy + 0.36 * fontSize).toFixed(1);
}

const FONT = 'Helvetica, Arial, sans-serif';

// Vector icon for each operation, drawn in a 200x200 space centered near (100,96).
function opIconMarkup(opKey, fill) {
  if (opKey === 'sleep') {
    return `<path d="M126 122a44 44 0 1 1-48-60 34 34 0 0 0 48 60z" fill="${fill}"/>
    <circle cx="141" cy="66" r="5" fill="${fill}" fill-opacity="0.95"/>
    <circle cx="121" cy="50" r="3.5" fill="${fill}" fill-opacity="0.7"/>
    <circle cx="152" cy="88" r="3" fill="${fill}" fill-opacity="0.55"/>`;
  }
  if (opKey === 'restart') {
    // Clockwise 315° arc ending at the top-right; the arrowhead caps the arc end,
    // aligned with the tangent so it reads as continuous motion.
    return `<path d="M144 88A46 46 0 1 1 123 60" fill="none" stroke="${fill}" stroke-width="14" stroke-linecap="round"/>
    <path d="M131 46L115 74L146 73Z" fill="${fill}"/>`;
  }
  if (opKey === 'trash') {
    // Trash can: arc handle + solid rounded lid, tapered outlined body with
    // three slats, plus a sparkle + dot (echoing the sleep stars) for "clean".
    return `<path d="M88 52a12 11 0 0 1 24 0" fill="none" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>
    <rect x="58" y="55" width="84" height="13" rx="6.5" fill="${fill}"/>
    <path d="M72 80L128 80L123.4 132A9 9 0 0 1 114.4 140.2L85.6 140.2A9 9 0 0 1 76.6 132Z" fill="none" stroke="${fill}" stroke-width="9" stroke-linejoin="round"/>
    <line x1="89" y1="93" x2="87.8" y2="127" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>
    <line x1="100" y1="93" x2="100" y2="127" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>
    <line x1="111" y1="93" x2="112.2" y2="127" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>
    <path d="M154 32l3 7.5 7.5 3-7.5 3-3 7.5-3-7.5-7.5-3 7.5-3z" fill="${fill}" fill-opacity="0.9"/>
    <circle cx="166" cy="60" r="3" fill="${fill}" fill-opacity="0.55"/>`;
  }
  if (opKey === 'lock') {
    // Padlock: rounded shackle + solid rounded body. The keyhole (circle +
    // stem) is punched out of the body with fill-rule="evenodd" so it stays a
    // real hole on any background (idle color card or white firing icon).
    return `<path d="M76 92V68a24 24 0 0 1 48 0v24" fill="none" stroke="${fill}" stroke-width="11" stroke-linecap="round"/>
    <path fill-rule="evenodd" fill="${fill}" d="M73 90H127A13 13 0 0 1 140 103V133A13 13 0 0 1 127 146H73A13 13 0 0 1 60 133V103A13 13 0 0 1 73 90Z
      M103.5 118.19A8 8 0 1 0 96.5 118.19V128A3.5 3.5 0 0 0 103.5 128Z"/>`;
  }
  return `<path d="M66 74a44 44 0 1 0 68 0" fill="none" stroke="${fill}" stroke-width="14" stroke-linecap="round"/>
    <rect x="93" y="46" width="14" height="54" rx="7" fill="${fill}"/>`;
}

function placedIcon(opKey, fill, cx, cy, scale) {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-100 -96)">${opIconMarkup(opKey, fill)}</g>`;
}

function bgGradient(id, top, bottom) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
  </linearGradient></defs>`;
}

// Real arc geometry for the progress ring. The device renderer mishandles
// stroke-dasharray (the dash pattern repeats and looks like erased chunks),
// so we draw the remaining arc as an actual path instead.
// Angles: 0 = 12 o'clock, positive = clockwise.
function arcPath(cx, cy, r, sweepDeg) {
  const toXY = (a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [(cx + r * Math.cos(rad)).toFixed(2), (cy + r * Math.sin(rad)).toFixed(2)];
  };
  const [x1, y1] = toXY(0);
  const [x2, y2] = toXY(sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M${x1} ${y1}A${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// Idle: operation icon + label + duration chip. Nothing overlaps.
function idleSvg(opKey, duration) {
  const op = OPS[opKey];
  const label = esc(op.label);
  const fontSize = label.length > 7 ? 20 : 23;
  const gid = `bg_${opKey}_idle`;
  // Countdown actions show a duration chip; instant actions (Empty Trash) don't.
  const chip = op.noCountdown
    ? ''
    : `<rect x="73" y="158" width="54" height="25" rx="12.5" fill="${op.color}" fill-opacity="0.16"/>
  <text x="100" y="${centeredBaseline(170.5, 14)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="14" fill="${op.colorSoft}">${duration}s</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  ${bgGradient(gid, op.bgTop, op.bgBottom)}
  <rect width="${SIZE}" height="${SIZE}" rx="44" fill="url(#${gid})"/>
  <circle cx="100" cy="78" r="50" fill="${op.color}" fill-opacity="0.10"/>
  ${placedIcon(opKey, op.color, 100, 78, 0.66)}
  <text x="100" y="${centeredBaseline(140, fontSize)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fontSize}" letter-spacing="1.5" fill="#E9EDF5">${label}</text>
  ${chip}
</svg>`;
}

// Countdown: progress ring, big centered number, solid cancel pill at the bottom
// (drawn over the ring with an opaque background so nothing collides).
// `secondsLeft` is a float — the ring drains continuously (animated at ~10fps
// like the speed-test plugin) while the big number changes once per second.
function countdownSvg(opKey, secondsLeft, duration) {
  const op = OPS[opKey];
  const left = Math.max(0, secondsLeft);
  const fraction = Math.max(0, Math.min(1, left / duration));
  const sweep = fraction * 360;
  const remaining = Math.max(1, Math.ceil(left));
  const cancelText = esc(CANCEL_LINES.join(' '));
  const gid = `bg_${opKey}_count`;
  const rid = `ring_${opKey}`;
  // Full circle right at the start; a real arc path for everything else.
  const progress = sweep >= 359.5
    ? `<circle cx="100" cy="100" r="${RING_R}" fill="none" stroke="url(#${rid})" stroke-width="10" filter="url(#glow)"/>`
    : `<path d="${arcPath(100, 100, RING_R, sweep)}" fill="none" stroke="url(#${rid})" stroke-width="10" stroke-linecap="round" filter="url(#glow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  ${bgGradient(gid, op.bgTop, op.bgBottom)}
  <defs><linearGradient id="${rid}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${op.colorSoft}"/><stop offset="1" stop-color="${op.color}"/>
  </linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs>
  <rect width="${SIZE}" height="${SIZE}" rx="44" fill="url(#${gid})"/>
  <circle cx="100" cy="100" r="66" fill="#FFFFFF" fill-opacity="0.04"/>
  <circle cx="100" cy="100" r="${RING_R}" fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="10"/>
  ${progress}
  <text x="100" y="${centeredBaseline(94, 78)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="78" fill="#FFFFFF">${remaining}</text>
  <rect x="22" y="148" width="156" height="31" rx="15.5" fill="${op.bgBottom}" stroke="${op.color}" stroke-opacity="0.45" stroke-width="1.5"/>
  <text x="100" y="${centeredBaseline(163.5, 14)}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="14" fill="${op.colorSoft}">${cancelText}</text>
</svg>`;
}

// Firing: full-color card with the white icon, label and progress dots.
function firingSvg(opKey) {
  const op = OPS[opKey];
  const label = esc(op.firing);
  const fontSize = label.length > 9 ? 19 : 23;
  const gid = `bg_${opKey}_fire`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  ${bgGradient(gid, op.fireTop, op.fireBottom)}
  <rect width="${SIZE}" height="${SIZE}" rx="44" fill="url(#${gid})"/>
  <circle cx="100" cy="80" r="48" fill="#FFFFFF" fill-opacity="0.14"/>
  ${placedIcon(opKey, '#FFFFFF', 100, 80, 0.62)}
  <text x="100" y="${centeredBaseline(146, fontSize)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fontSize}" letter-spacing="0.5" fill="#FFFFFF">${label}</text>
  <circle cx="84" cy="172" r="4" fill="#FFFFFF" fill-opacity="0.95"/>
  <circle cx="100" cy="172" r="4" fill="#FFFFFF" fill-opacity="0.6"/>
  <circle cx="116" cy="172" r="4" fill="#FFFFFF" fill-opacity="0.3"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// One instance per key (context).
// ---------------------------------------------------------------------------

class ControlAction {
  constructor(context, opKey) {
    this.context = context;
    this.opKey = opKey;
    this.op = OPS[opKey];
    this.duration = DEFAULT_DURATION;
    this.deadline = 0;
    this.timer = null;
    this.active = true;
  }

  secondsLeft() {
    return Math.max(0, (this.deadline - Date.now()) / 1000);
  }

  isCounting() {
    return this.timer !== null;
  }

  applySettings(settings) {
    const d = Number(settings && settings.duration);
    if (ALLOWED_DURATIONS.includes(d)) this.duration = d;
    // Never disturb a running countdown; the new duration takes effect next time.
    if (!this.isCounting()) this.renderIdle();
  }

  onRun() {
    // Instant actions (Empty Trash) fire on every tap — no countdown, no cancel.
    if (this.op.noCountdown) {
      this.fire();
      return;
    }
    if (this.isCounting()) this.cancel();
    else this.start();
  }

  start() {
    // Deadline-based with a fast tick: the ring drains smoothly (~10fps, same
    // technique as the speed-test plugin) instead of jumping once per second.
    this.deadline = Date.now() + this.duration * 1000;
    this.renderCountdown();
    this.timer = setInterval(() => {
      if (this.secondsLeft() <= 0) this.fire();
      else this.renderCountdown();
    }, 100);
    log(`${this.opKey}: countdown started (${this.duration}s)`);
  }

  cancel() {
    this.clearTimer();
    this.renderIdle();
    log(`${this.opKey}: cancelled`);
  }

  fire() {
    this.clearTimer();
    this.renderFiring();
    log(`${this.opKey}: executing -> ${this.op.cmd}`);
    exec(this.op.cmd, (err) => {
      if (err) log(`${this.opKey}: exec error: ${err.message}`);
    });
    // For sleep the process survives; restore the idle look once it wakes.
    // For restart/shutdown the machine goes down before this runs.
    setTimeout(() => {
      if (!this.isCounting()) this.renderIdle();
    }, 2000);
  }

  clearTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setActive(active) {
    this.active = active;
    if (!active) return;
    if (this.isCounting()) this.renderCountdown();
    else this.renderIdle();
  }

  destroy() {
    this.clearTimer();
  }

  send(svg) {
    if (!this.active) return;
    $UD.setBaseDataIcon(this.context, svgToIcon(svg));
  }

  renderIdle() {
    this.send(idleSvg(this.opKey, this.duration));
  }

  renderCountdown() {
    this.send(countdownSvg(this.opKey, this.secondsLeft(), this.duration));
  }

  renderFiring() {
    this.send(firingSvg(this.opKey));
  }
}

// ---------------------------------------------------------------------------
// Wire up host events.
// ---------------------------------------------------------------------------

// Exported for offline tests (see scripts run during development). The guard
// lets a test import this module without opening the WebSocket connection.
export { OPS, idleSvg, countdownSvg, firingSvg, ControlAction, applyLocale };

if (process.env.MACCTRL_NO_CONNECT) {
  log('loaded without connecting (test mode)');
} else {
  run();
}

function run() {
$UD.connect(PLUGIN_UUID);

// connect() parses the host language from argv synchronously.
applyLocale($UD.language);

$UD.onConnected(() => log('connected'));

$UD.onAdd((jsn) => {
  const context = jsn.context;
  let inst = INSTANCES[context];
  if (!inst) {
    inst = new ControlAction(context, opKeyFromContext(context));
    INSTANCES[context] = inst;
  }
  inst.applySettings(jsn.param || {});
});

$UD.onRun((jsn) => {
  const inst = INSTANCES[jsn.context];
  if (!inst) {
    // Not initialised yet — let onAdd build it first, then it will be ready.
    $UD.emit('add', jsn);
    return;
  }
  inst.onRun();
});

$UD.onParamFromApp((jsn) => {
  const inst = INSTANCES[jsn.context];
  if (inst) inst.applySettings(jsn.param || {});
});

$UD.onParamFromPlugin((jsn) => {
  const inst = INSTANCES[jsn.context];
  if (inst) inst.applySettings(jsn.param || {});
});

$UD.onSetActive((jsn) => {
  const inst = INSTANCES[jsn.context];
  if (inst) inst.setActive(jsn.active);
});

$UD.onClear((jsn) => {
  if (!jsn.param) return;
  for (const item of jsn.param) {
    const context = item.context;
    const inst = INSTANCES[context];
    if (inst) {
      inst.destroy();
      delete INSTANCES[context];
    }
  }
});
}

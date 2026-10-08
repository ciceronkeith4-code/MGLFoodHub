import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------
// Money — always handled in centavos to avoid floating point drift.
// ---------------------------------------------------------------------
export const toCents = (n: number | string) => Math.round(Number(n) * 100)

export function peso(n: number | string): string {
  const value = toCents(n) / 100
  return '₱' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------
// Time & dates — everything is Asia/Manila.
// ---------------------------------------------------------------------
export const TZ = 'Asia/Manila'

/** "07:30:00" | "07:30" → minutes since midnight */
export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** minutes → "HH:MM" */
export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** "13:30" → "1:30 PM" */
export function formatTime(t: string): string {
  const min = toMinutes(t)
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 || h === 24 ? 'AM' : 'PM'}`
}

export function formatHours(open: string, close: string): string {
  return `${formatTime(open)} – ${formatTime(close)}`
}

/** "11:00-12:00" → "11:00 AM – 12:00 PM" */
export function slotLabel(slot: string): string {
  const [a, b] = slot.split('-')
  if (!a || !b) return slot
  return `${formatTime(a)} – ${formatTime(b)}`
}

/** Current date ("YYYY-MM-DD") and minutes-of-day in Manila. */
export function manilaNow(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/** Adds days to a "YYYY-MM-DD" string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "YYYY-MM-DD" → local Date at midnight (for date pickers). */
export function dateFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** local Date → "YYYY-MM-DD" (calendar date as shown in the picker). */
export function ymdFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "2026-10-09" → "Fri, Oct 9, 2026" */
export function formatDate(ymd: string, style: 'short' | 'long' = 'short'): string {
  if (!ymd) return ''
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`)
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: style === 'long' ? 'long' : 'short',
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** ISO timestamp → "Oct 7, 2026, 8:15 PM" in Manila time */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Manila calendar date of an ISO timestamp. */
export function manilaDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  )
}

export function isOpenNow(open: string, close: string): boolean {
  const { minutes } = manilaNow()
  return minutes >= toMinutes(open) && minutes < toMinutes(close)
}

// ---------------------------------------------------------------------
// Phone & validation
// ---------------------------------------------------------------------
export function normalizePhone(raw: string): string | null {
  const v = raw.replace(/[\s().-]/g, '')
  if (/^09\d{9}$/.test(v)) return v
  if (/^\+639\d{9}$/.test(v)) return '0' + v.slice(3)
  return null
}

/** "09171234567" → "0917-123-4567" */
export function formatPhone(p: string): string {
  const n = normalizePhone(p) ?? p
  return /^09\d{9}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4, 7)}-${n.slice(7)}` : p
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim())

/** Social handle/link → URL to open (admin side). */
export function socialUrl(s: string): string | null {
  const v = s.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (/^(www\.)?(facebook|fb|instagram|m\.facebook)\.(com|me)\//i.test(v)) return `https://${v}`
  if (v.startsWith('@')) return `https://www.instagram.com/${v.slice(1)}`
  return null
}

export function trackingUrl(token: string): string {
  return `${window.location.origin}/track/${token}`
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {
      /* insecure context — fall through */
    }
  }
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Safe localStorage access (private mode / blocked storage never crashes the app). */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  },
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

import { formatHours, fromMinutes, slotLabel, toMinutes } from './utils'

export interface SlotStore {
  name: string
  open_time: string
  close_time: string
}

export interface SlotResult {
  slots: { value: string; label: string }[]
  /** Set when the stores in the cart share no 1-hour window. */
  conflict: string | null
  window: { open: string; close: string } | null
}

/**
 * 1-hour delivery slots that fall inside the hours of EVERY store in the cart.
 * Mirrors the server-side check in place_order().
 */
export function computeSlots(stores: SlotStore[]): SlotResult {
  if (stores.length === 0) return { slots: [], conflict: null, window: null }

  const latestOpen = stores.reduce((a, b) => (toMinutes(b.open_time) > toMinutes(a.open_time) ? b : a))
  const earliestClose = stores.reduce((a, b) => (toMinutes(b.close_time) < toMinutes(a.close_time) ? b : a))
  const open = toMinutes(latestOpen.open_time)
  const close = toMinutes(earliestClose.close_time)

  if (close - open < 60) {
    const pair =
      latestOpen.name === earliestClose.name
        ? `${latestOpen.name} (${formatHours(latestOpen.open_time, latestOpen.close_time)})`
        : `${earliestClose.name} (${formatHours(earliestClose.open_time, earliestClose.close_time)}) and ${latestOpen.name} (${formatHours(latestOpen.open_time, latestOpen.close_time)})`
    return {
      slots: [],
      window: null,
      conflict: `${pair} have no common delivery hours, so they can't be delivered together. Please place separate orders for these stores.`,
    }
  }

  const slots: SlotResult['slots'] = []
  for (let start = open; start + 60 <= close; start += 60) {
    const value = `${fromMinutes(start)}-${fromMinutes(start + 60)}`
    slots.push({ value, label: slotLabel(value) })
  }
  return { slots, conflict: null, window: { open: fromMinutes(open), close: fromMinutes(close) } }
}

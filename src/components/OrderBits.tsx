import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { toast } from 'sonner'
import { Copy, Download, Share2 } from 'lucide-react'
import type { PublicOrderItem } from '@/lib/types'
import { copyText, peso } from '@/lib/utils'
import { Button } from './ui/button'

/** Copy / Share / QR download for the private tracking link. */
export function TrackingLinkActions({ url, orderNumber, showQr = true }: { url: string; orderNumber: string; showQr?: boolean }) {
  const qrRef = useRef<HTMLCanvasElement>(null)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const downloadQr = () => {
    const canvas = qrRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${orderNumber}-tracking-qr.png`
    a.click()
  }

  return (
    <div className="space-y-4">
      <div className="break-all rounded-xl border border-sand-200 bg-white px-3 py-2.5 font-mono text-sm text-navy select-all">{url}</div>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="navy" onClick={async () => ((await copyText(url)) ? toast.success('Link copied!') : toast.error('Could not copy. Please copy it manually.'))}>
          <Copy /> Copy
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            if (canShare) {
              try {
                await navigator.share({ title: `MGL Food Hub order ${orderNumber}`, text: `Track my MGL Food Hub order ${orderNumber}:`, url })
              } catch {
                /* cancelled */
              }
            } else if (await copyText(url)) {
              toast.success('Link copied — paste it in Messenger, Viber or SMS.')
            }
          }}
        >
          <Share2 /> Share
        </Button>
        <Button variant="outline" onClick={downloadQr}>
          <Download /> QR
        </Button>
      </div>
      <div className={showQr ? 'flex justify-center' : 'hidden'}>
        <div className="rounded-2xl border border-sand-200 bg-white p-3">
          <QRCodeCanvas ref={qrRef} value={url} size={180} marginSize={2} fgColor="#0D2B4E" level="M" />
          <p className="mt-1 text-center text-xs text-navy/55">Scan to open your tracking page</p>
        </div>
      </div>
    </div>
  )
}

/** Read-only items grouped by store (tracking + order placed pages). */
export function OrderItemsList({ items }: { items: PublicOrderItem[] }) {
  const groups = new Map<string, PublicOrderItem[]>()
  for (const i of items) groups.set(i.store_name, [...(groups.get(i.store_name) ?? []), i])
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([store, list]) => (
        <div key={store} className="overflow-hidden rounded-xl ring-1 ring-sand-200/70">
          <p className="border-b border-sand bg-sand/60 px-3 py-2 font-heading text-sm font-bold">{store}</p>
          <ul className="divide-y divide-sand text-sm">
            {list.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {i.quantity}× {i.product_name}
                  </p>
                  <p className="text-xs text-navy/55">
                    {[
                      i.section_name && i.section_name !== i.product_name ? i.section_name : null,
                      i.variant_label !== 'Regular' ? i.variant_label : null,
                      ...i.options.map((o) => (o.group === 'Extra Toppings' ? 'Extra toppings' : `${o.group}: ${o.choice}`)),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{peso(i.line_total)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

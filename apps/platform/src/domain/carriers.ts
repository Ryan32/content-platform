import type { Material } from './library'

/**
 * Groups a carrier's items by what the advisor needs to do (design: Carriers). Uses the item's type, audience and topics,
 * so nothing extra has to be tagged. First match wins.
 */
export const CARRIER_GROUPS: { id: string; label: string; match: (m: Material) => boolean }[] = [
  { id: 'howto', label: 'How-to articles', match: m => m.kind === 'howto' },
  { id: 'clients', label: 'For clients & planning', match: m => m.audience === 'client' || (m.section === 'planning') },
  { id: 'pay', label: 'Pay & product', match: m => (m.topics ?? []).some(t => ['products:commission-schedules', 'products:rates-performance', 'products:carrier-snapshots', 'products:product-changes'].includes(t)) },
  { id: 'apply', label: 'Apply & submit', match: m => (m.topics ?? []).some(t => ['operations:forms', 'operations:sample-applications', 'operations:new-business-nigo'].includes(t)) },
  { id: 'service', label: 'Service in-force business', match: m => (m.topics ?? []).some(t => ['operations:transfers', 'operations:schwab-fidelity', 'operations:compliance'].includes(t)) },
  { id: 'underwriting', label: 'Life underwriting', match: m => (m.lines ?? []).includes('life') },
  { id: 'other', label: 'More resources', match: () => true },
]

export function carrierGroups(items: Material[]) {
  const groups = CARRIER_GROUPS.map(g => ({ id: g.id, label: g.label, items: [] as Material[] }))
  for (const item of items) groups[CARRIER_GROUPS.findIndex(g => g.match(item))].items.push(item)
  return groups.filter(g => g.items.length)
}

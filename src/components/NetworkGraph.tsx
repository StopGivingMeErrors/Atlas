import { useMemo, useRef, useState } from 'react'
import { Building2, Calendar, FileText, Globe, User } from 'lucide-react'
import type { NetworkEdge, NetworkNode, NetworkNodeType } from '../types'
import { cn } from '../lib/utils'
import { Pill } from './ui/primitives'

const nodeStyle: Record<NetworkNodeType, { color: string; icon: typeof User }> = {
  person: { color: '#4cc2ff', icon: User },
  organization: { color: '#7c9cf5', icon: Building2 },
  website: { color: '#4ade80', icon: Globe },
  publication: { color: '#fbbf24', icon: FileText },
  event: { color: '#e879a6', icon: Calendar },
}

interface Positioned extends NetworkNode {
  x: number
  y: number
}

/**
 * Lightweight SVG network view: subject-centred radial layout with
 * pan/zoom, type filtering, and evidence-weighted edges.
 */
export function NetworkGraph({ nodes, edges }: { nodes: NetworkNode[]; edges: NetworkEdge[] }) {
  const [selected, setSelected] = useState<Positioned | null>(null)
  const [hiddenTypes, setHiddenTypes] = useState<Set<NetworkNodeType>>(new Set())
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const positioned = useMemo<Positioned[]>(() => {
    const cx = 400
    const cy = 260
    const center = nodes[0]
    const satellites = nodes.slice(1)
    return [
      { ...center, x: cx, y: cy },
      ...satellites.map((node, i) => {
        const angle = (i / satellites.length) * Math.PI * 2 - Math.PI / 2
        const radius = 170
        return { ...node, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
      }),
    ]
  }, [nodes])

  const visible = positioned.filter((n) => !hiddenTypes.has(n.type))
  const visibleIds = new Set(visible.map((n) => n.id))
  const visibleEdges = edges.filter(
    (e) => visibleIds.has(e.sourceNodeId) && visibleIds.has(e.targetNodeId),
  )

  const toggleType = (type: NetworkNodeType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const byId = new Map(positioned.map((n) => [n.id, n]))

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(Object.keys(nodeStyle) as NetworkNodeType[]).map((type) => (
          <button key={type} onClick={() => toggleType(type)}>
            <Pill
              tone="neutral"
              className={cn(
                'cursor-pointer capitalize transition-opacity',
                hiddenTypes.has(type) && 'opacity-40',
              )}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: nodeStyle[type].color }}
              />
              {type}
            </Pill>
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink-faint">Scroll to zoom · drag to pan</span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-edge bg-surface-1">
        <svg
          viewBox="0 0 800 520"
          className="h-[420px] w-full cursor-grab active:cursor-grabbing"
          onWheel={(e) => {
            const scale = Math.min(2.5, Math.max(0.5, transform.scale - e.deltaY * 0.0015))
            setTransform((t) => ({ ...t, scale }))
          }}
          onPointerDown={(e) => {
            dragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              baseX: transform.x,
              baseY: transform.y,
            }
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return
            const { startX, startY, baseX, baseY } = dragRef.current
            setTransform((t) => ({ ...t, x: baseX + (e.clientX - startX), y: baseY + (e.clientY - startY) }))
          }}
          onPointerUp={() => (dragRef.current = null)}
          onPointerLeave={() => (dragRef.current = null)}
        >
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
            {visibleEdges.map((edge) => {
              const a = byId.get(edge.sourceNodeId)
              const b = byId.get(edge.targetNodeId)
              if (!a || !b) return null
              const midX = (a.x + b.x) / 2
              const midY = (a.y + b.y) / 2
              return (
                <g key={edge.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#303945"
                    strokeWidth={0.75 + edge.strength * 2}
                    strokeOpacity={0.35 + edge.strength * 0.45}
                  />
                  <text
                    x={midX}
                    y={midY - 5}
                    textAnchor="middle"
                    className="fill-ink-muted"
                    fontSize={9}
                  >
                    {edge.relationship}
                  </text>
                  {edge.evidenceIds.length > 0 && (
                    <text x={midX} y={midY + 7} textAnchor="middle" className="fill-ink-faint" fontSize={8}>
                      {edge.evidenceIds.length} evidence
                    </text>
                  )}
                </g>
              )
            })}

            {visible.map((node) => {
              const style = nodeStyle[node.type]
              const isSelected = selected?.id === node.id
              const isCenter = node.id === positioned[0]?.id
              const r = isCenter ? 26 : 20
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelected(isSelected ? null : node)}
                >
                  <circle
                    r={r + 4}
                    fill="transparent"
                    stroke={isSelected ? style.color : 'transparent'}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                  <circle r={r} fill="#14181d" stroke={style.color} strokeWidth={1.5} />
                  <circle r={r} fill={style.color} fillOpacity={0.12} />
                  <text textAnchor="middle" dy={3} fontSize={isCenter ? 11 : 9} className="fill-ink pointer-events-none select-none">
                    {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
                  </text>
                  <text textAnchor="middle" y={r + 13} fontSize={8.5} className="fill-ink-muted pointer-events-none select-none">
                    {node.sublabel}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        {selected && (
          <div className="animate-fade-up absolute right-3 top-3 w-56 rounded-md border border-edge bg-surface-2 p-3 shadow-panel">
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded"
                style={{ backgroundColor: `${nodeStyle[selected.type].color}20`, color: nodeStyle[selected.type].color }}
              >
                {(() => {
                  const Icon = nodeStyle[selected.type].icon
                  return <Icon size={13} />
                })()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">{selected.label}</p>
                <p className="text-[11px] capitalize text-ink-muted">{selected.type} · {selected.sublabel}</p>
              </div>
            </div>
            <div className="mt-2 border-t border-edge pt-2 text-[11px] text-ink-muted">
              {visibleEdges.filter(
                (e) => e.sourceNodeId === selected.id || e.targetNodeId === selected.id,
              ).length}{' '}
              evidence-backed relationships
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

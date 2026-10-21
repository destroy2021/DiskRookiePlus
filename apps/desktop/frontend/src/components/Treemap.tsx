import { useMemo, useState, useEffect, useRef } from 'react'

export interface TreemapNode {
  name: string
  path: string
  size: number
  is_dir?: boolean
  /** Unix 时间戳（秒），最近修改时间 */
  modified?: number | null
  children?: TreemapNode[]
}

interface Block {
  x: number
  y: number
  w: number
  h: number
  node: TreemapNode
}

/** 平衡二分布局：沿当前长边切分，避免小目录全部挤成横向细条。 */
function layoutBalanced(
  nodes: TreemapNode[],
  x: number,
  y: number,
  w: number,
  h: number
): Block[] {
  const sorted = [...nodes].filter((n) => n.size > 0).sort((a, b) => b.size - a.size)
  const result: Block[] = []

  function split(items: TreemapNode[], sx: number, sy: number, sw: number, sh: number) {
    if (items.length === 0) return
    if (items.length === 1) {
      result.push({ node: items[0], x: sx, y: sy, w: sw, h: sh })
      return
    }

    const total = items.reduce((sum, node) => sum + node.size, 0)
    const target = total / 2
    let splitAt = 1
    let firstTotal = items[0].size
    while (splitAt < items.length - 1) {
      const withNext = firstTotal + items[splitAt].size
      if (Math.abs(target - withNext) > Math.abs(target - firstTotal)) break
      firstTotal = withNext
      splitAt++
    }

    const ratio = firstTotal / total
    const first = items.slice(0, splitAt)
    const second = items.slice(splitAt)
    if (sw >= sh) {
      const firstWidth = sw * ratio
      split(first, sx, sy, firstWidth, sh)
      split(second, sx + firstWidth, sy, sw - firstWidth, sh)
    } else {
      const firstHeight = sh * ratio
      split(first, sx, sy, sw, firstHeight)
      split(second, sx, sy + firstHeight, sw, sh - firstHeight)
    }
  }

  split(sorted, x, y, w, h)
  return result
}

interface TreemapProps {
  root: TreemapNode
  width: number
  height: number
  onHover?: (node: TreemapNode | null) => void
}

export function Treemap({ root, width, height, onHover }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [navigationState, setNavigationState] = useState<{ root: TreemapNode; nodes: TreemapNode[]; zoom: number }>({
    root,
    nodes: [root],
    zoom: 1,
  })
  const [dimensions, setDimensions] = useState({ width, height })
  const navigation = useMemo(
    () => (navigationState.root === root ? navigationState.nodes : [root]),
    [navigationState, root]
  )
  const zoom = navigationState.root === root ? navigationState.zoom : 1
  const currentRoot = navigation[navigation.length - 1] ?? root
  const canvasWidth = dimensions.width * zoom
  const canvasHeight = dimensions.height * zoom

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width: w, height: h } = entries[0]?.contentRect ?? { width, height }
      setDimensions({ width: Math.max(1, w), height: Math.max(1, h) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [height, width])

  const blocks = useMemo<Block[]>(() => {
    const children = (currentRoot.children ?? []).filter((child) => child.size > 0)
    return layoutBalanced(
      children,
      2,
      2,
      Math.max(1, canvasWidth - 4),
      Math.max(1, canvasHeight - 4)
    )
  }, [currentRoot, canvasWidth, canvasHeight])

  const blockColors = [
    '#9ec5e6',
    '#9bcfc5',
    '#b8afe0',
    '#a8c7d8',
    '#a6b8d9',
    '#afd5cc',
    '#b6c2ce',
    '#b5cbed',
  ]

  const openNode = (node: TreemapNode) => {
    if ((node.children?.length ?? 0) > 0) {
      setNavigationState({ root, nodes: [...navigation, node], zoom: 1 })
      onHover?.(null)
    }
  }

  useEffect(() => {
    const viewport = containerRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()

      const nextZoom = Math.min(8, Math.max(1, zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2)))
      if (nextZoom === zoom) return

      const rect = viewport.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const contentX = (viewport.scrollLeft + pointerX) / zoom
      const contentY = (viewport.scrollTop + pointerY) / zoom

      setNavigationState({ root, nodes: navigation, zoom: nextZoom })
      requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * nextZoom - pointerX
        viewport.scrollTop = contentY * nextZoom - pointerY
      })
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [navigation, root, zoom])

  return (
    <div className="w-full h-full min-h-[350px] flex flex-col">
      <div className="h-8 shrink-0 flex items-center gap-2 px-1 text-xs">
        <nav className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto" aria-label="目录层级">
          {navigation.map((node, index) => (
            <span key={`${node.path}-${index}`} className="flex items-center gap-1 shrink-0">
              {index > 0 && <span className="text-slate-400">/</span>}
              <button
                type="button"
                className="max-w-48 truncate rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-gray-300 dark:hover:bg-gray-700"
                onClick={() => {
                  setNavigationState({ root, nodes: navigation.slice(0, index + 1), zoom: 1 })
                  onHover?.(null)
                }}
                title={node.path}
              >
                {node.name}
              </button>
            </span>
          ))}
        </nav>
        <span className="shrink-0 text-slate-400" title="按住 Ctrl 并滚动鼠标滚轮缩放">
          Ctrl + 滚轮 · {Math.round(zoom * 100)}%
        </span>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <svg width={canvasWidth} height={canvasHeight} className="block">
          {blocks.map((block, i) => {
            const color = blockColors[(i + navigation.length - 1) % blockColors.length]
            const showLabel = block.w > 40 && block.h > 22
            const canOpen = (block.node.children?.length ?? 0) > 0
            return (
              <g
                key={`${block.node.path}-${i}`}
                role={canOpen ? 'button' : undefined}
                tabIndex={canOpen ? 0 : undefined}
                aria-label={canOpen ? `打开 ${block.node.name}` : block.node.name}
                onClick={() => openNode(block.node)}
                onKeyDown={(event) => {
                  if (canOpen && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    openNode(block.node)
                  }
                }}
              >
                <title>{`${block.node.path} · ${block.node.size.toLocaleString()} bytes`}</title>
                <rect
                  x={block.x}
                  y={block.y}
                  width={block.w}
                  height={block.h}
                  fill={color}
                  stroke="rgba(0,0,0,0.12)"
                  strokeWidth={1}
                  onMouseEnter={() => onHover?.(block.node)}
                  onMouseLeave={() => onHover?.(null)}
                  className={`${canOpen ? 'cursor-pointer' : 'cursor-default'} transition-opacity hover:opacity-90`}
                />
                {showLabel && (
                  <text
                    x={block.x + block.w / 2}
                    y={block.y + block.h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#1a1a1a"
                    className="pointer-events-none select-none font-medium"
                    style={{ fontSize: Math.min(10, block.w / 5, block.h / 2.5) }}
                  >
                    {block.node.name.length > 12
                      ? block.node.name.slice(0, 10) + '…'
                      : block.node.name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import type { AsteroidIndexEntry, AsteroidManifest, BodyId } from '../types'

type Props = {
  manifest: AsteroidManifest | null
  searchText: string
  orbitClassFilter: string
  results: AsteroidIndexEntry[]
  selectedIds: Set<BodyId>
  loadedIds: Set<BodyId>
  isSearching: boolean
  isSectionLoading: boolean
  hasMore: boolean
  hasPrevious: boolean
  loadedCatalogCount: number
  onSearchTextChange: (value: string) => void
  onOrbitClassFilterChange: (value: string) => void
  onAddResult: (entry: AsteroidIndexEntry) => void
  onRemoveLoadedCatalogBodies: () => void
  onLoadPrevious: () => void
  onLoadMore: () => void
}

const ORBIT_FILTERS = [
  { value: 'all', label: '全部分类' },
  { value: 'MBA', label: '主带' },
  { value: 'TNO', label: '外海王星' },
  { value: 'APO', label: '阿波罗' },
  { value: 'ATE', label: '阿登' },
  { value: 'AMO', label: '阿莫尔' },
  { value: 'JTA', label: '木星特洛伊' },
]

export function CatalogPanel({
  manifest,
  searchText,
  orbitClassFilter,
  results,
  selectedIds,
  loadedIds,
  isSearching,
  isSectionLoading,
  hasMore,
  hasPrevious,
  loadedCatalogCount,
  onSearchTextChange,
  onOrbitClassFilterChange,
  onAddResult,
  onRemoveLoadedCatalogBodies,
  onLoadPrevious,
  onLoadMore,
}: Props) {
  const isSearchMode = Boolean(searchText.trim())
  const listRef = useRef<HTMLDivElement | null>(null)
  const pendingPrependHeightRef = useRef<number | null>(null)
  const resultCountRef = useRef(results.length)

  useEffect(() => {
    const listElement = listRef.current
    if (!listElement) {
      resultCountRef.current = results.length
      return
    }

    if (pendingPrependHeightRef.current !== null && results.length > resultCountRef.current) {
      listElement.scrollTop += listElement.scrollHeight - pendingPrependHeightRef.current
      pendingPrependHeightRef.current = null
    }

    resultCountRef.current = results.length
  }, [results.length])

  return (
    <div className="panel-block catalog-panel">
      <div className="field-header">
        <span>小行星目录</span>
        <strong>{manifest ? `${manifest.totalCount.toLocaleString('zh-CN')} 个` : '未生成'}</strong>
      </div>

      <div className="catalog-summary">
        {manifest ? (
          <>
            <p>
              目录来自本地分块静态数据。分区滚动只会载入窗口内星体，只有手动点选后才会进入轨迹绘制。
            </p>
            <p>
              当前窗口/已保留小天体：<strong>{loadedCatalogCount}</strong>
            </p>
          </>
        ) : (
          <p>
            尚未检测到完整小行星目录。运行 <code>npm run preprocess:asteroids</code> 后即可生成本地分块数据。
          </p>
        )}
      </div>

      <label className="field">
        <span>搜索小行星</span>
        <input
          type="search"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          placeholder="例如：vesta、ceres、433 eros、bennu"
          disabled={!manifest}
        />
      </label>

      <label className="field">
        <span>轨道分类</span>
        <select
          value={orbitClassFilter}
          onChange={(event) => onOrbitClassFilterChange(event.target.value)}
          disabled={!manifest}
        >
          {ORBIT_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="catalog-toolbar">
        <span className="catalog-hint">
          {isSearchMode
            ? isSearching
              ? '正在加载搜索分片…'
              : `搜索结果 ${results.length} 条`
            : isSectionLoading
              ? '正在载入该分区星体…'
              : `分区已载入 ${results.length} 个`}
        </span>
        <button type="button" onClick={onRemoveLoadedCatalogBodies} disabled={!loadedCatalogCount}>
          清空已加载小天体
        </button>
      </div>

      <div
        ref={listRef}
        className="result-list"
        onScroll={(event) => {
          const element = event.currentTarget
          if (element.scrollTop < 48 && hasPrevious && !isSectionLoading && !isSearching) {
            pendingPrependHeightRef.current = element.scrollHeight
            onLoadPrevious()
            return
          }

          const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight

          if (distanceToBottom < 180 && hasMore && !isSectionLoading && !isSearching) {
            onLoadMore()
          }
        }}
      >
        {results.length ? (
          results.map((entry) => {
            const isSelected = selectedIds.has(entry.id)
            const isLoaded = loadedIds.has(entry.id)

            return (
              <button
                key={entry.id}
                type="button"
                className={`result-card ${isLoaded ? 'loaded' : ''} ${isSelected ? 'selected' : ''}`}
                onClick={() => onAddResult(entry)}
              >
                <span className="result-title">{entry.shortLabel}</span>
                <span className="result-meta">
                  {entry.orbitClassName}
                  {entry.isNeo ? ' · NEO' : ''}
                  {entry.isPha ? ' · PHA' : ''}
                  {isSelected ? ' · 已绘制' : isLoaded ? ' · 已载入' : ''}
                </span>
              </button>
            )
          })
        ) : (
          <div className="catalog-empty">
            {manifest
              ? isSearchMode
                ? '没有匹配的小行星，请尝试其他名称、编号或代号。'
                : '选择一个分区后会先载入一批星体，滚动到底部时会继续加载更多，并回收窗口外未点选星体。'
              : '目录文件生成后，这里会显示匹配到的小行星结果。'}
          </div>
        )}

        {(isSectionLoading || isSearching) && (
          <div className="catalog-loading">{isSearchMode ? '正在搜索…' : '正在追加加载…'}</div>
        )}

        {!isSearchMode && hasPrevious && !isSectionLoading && results.length > 0 && (
          <div className="catalog-more-hint">继续向上滚动可回补更前面的该分区小行星</div>
        )}

        {!isSearchMode && hasMore && !isSectionLoading && results.length > 0 && (
          <div className="catalog-more-hint">继续向下滚动可加载更多该分区小行星</div>
        )}
      </div>
    </div>
  )
}

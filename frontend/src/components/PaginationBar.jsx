import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 300];

/**
 * Shared list pagination.  Page size is deliberately a bounded choice so a
 * large ontology does not accidentally render thousands of rows at once.
 */
export default function PaginationBar({ page = 1, pageSize = 20, total = 0, onPageChange, onPageSizeChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  return <footer className="list-pagination">
    <span>共 {total} 条 · 第 {current} / {pages} 页</span>
    <label>每页
      <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
        {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 条</option>)}
      </select>
    </label>
    <button type="button" disabled={current <= 1} onClick={() => onPageChange(current - 1)} aria-label="上一页"><ChevronLeft size={14} />上一页</button>
    <button type="button" disabled={current >= pages} onClick={() => onPageChange(current + 1)} aria-label="下一页">下一页<ChevronRight size={14} /></button>
  </footer>;
}

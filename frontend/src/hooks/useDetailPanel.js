import { useCallback, useState } from 'react';

/**
 * 右侧详情的通用开关。
 * 默认收起；点击列表项时显式展开，详情头部可再次收起。
 * selected 与 open 分开，避免关闭详情时丢失列表选中态。
 */
export default function useDetailPanel(initialOpen = false) {
  const [detailOpen, setDetailOpen] = useState(Boolean(initialOpen));
  const openDetail = useCallback(() => setDetailOpen(true), []);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  return { detailOpen, openDetail, closeDetail };
}

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { historyReturnUrl } from '../historyNavigation';

export default function useHistoryResourceFocus({ resourceTypes, items, visible, pageSize, setPage, onSelect, ready = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const params = new URLSearchParams(location.search);
  const focusedId = params.get('from_history') === '1' && resourceTypes.includes(params.get('resource_type'))
    ? params.get('resource_id') : '';
  useEffect(() => {
    if (!ready || !focusedId || !items) return;
    const target = items.find((item) => String(item.id) === focusedId);
    if (!target) {
      const returnUrl = historyReturnUrl(location.search);
      navigate(`${returnUrl}&not_found=1`, { replace: true });
      return;
    }
    onSelectRef.current(target);
    const index = visible.findIndex((item) => String(item.id) === focusedId);
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
  }, [focusedId, ready, items, visible, pageSize, location.search, navigate, setPage]);
  return focusedId;
}

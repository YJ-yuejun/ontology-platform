import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function useCreateIntent(ready, onCreate) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!ready || params.get('create') !== '1') return;
    onCreate();
    params.delete('create');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : '' }, { replace: true });
  }, [ready, location.search]);
}

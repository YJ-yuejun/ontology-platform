import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { DictionaryItems } from '../components/DictionaryManager';

export default function DictionaryManagement() {
  const [params, setParams] = useSearchParams();
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const kind = params.get('type') || 'data_type';
  useEffect(() => {
    const refresh = () => api('/api/model-dictionaries').then((rows) => { setTypes(rows); setError(''); }).catch((cause) => setError(cause.message));
    refresh();
    window.addEventListener('model-dictionary-updated', refresh);
    return () => window.removeEventListener('model-dictionary-updated', refresh);
  }, []);
  return <div className="dictionary-page"><header><div><h2>字典管理</h2><p>全局共享的语义选项；业务主题在独立目录中管理。</p></div></header>{error && <p className="dictionary-message error">加载字典类别失败：{error}</p>}<div className="dictionary-page-layout"><nav aria-label="字典类别">{types.map((item) => <button type="button" key={item.key} className={kind === item.key ? 'selected' : ''} onClick={() => setParams({ type: item.key })}><span>{item.name}</span><em>{item.count}</em></button>)}</nav><main><h3>{types.find((item) => item.key === kind)?.name || '字典项'}</h3><DictionaryItems key={kind} kind={kind} /></main></div></div>;
}

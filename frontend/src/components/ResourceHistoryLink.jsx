import { useNavigate } from 'react-router-dom';
import { History } from 'lucide-react';

export default function ResourceHistoryLink({ resourceType, resourceId, label = '变更记录' }) {
  const navigate = useNavigate();
  if (!resourceType || !resourceId) return null;
  const openHistory = (event) => {
    event.stopPropagation();
    const params = new URLSearchParams({ resource_type: resourceType, resource_id: String(resourceId) });
    navigate(`/ontology/governance/activity?${params}`);
  };
  return <button type="button" className="resource-history-link" onClick={openHistory} title="查看此资源的变更记录"><History size={14} /> {label}</button>;
}

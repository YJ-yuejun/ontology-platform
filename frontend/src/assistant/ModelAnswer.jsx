import { Fragment } from 'react';

function inline(text, key) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}-b-${index}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${key}-c-${index}`}>{part.slice(1, -1)}</code>;
    return <Fragment key={`${key}-t-${index}`}>{part}</Fragment>;
  });
}

export default function ModelAnswer({ text }) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let list = null;
  const flushList = () => {
    if (!list) return;
    const Tag = list.type;
    blocks.push(<Tag key={`list-${blocks.length}`} className="model-answer-list">{list.items.map((item, index) => <li key={index}>{inline(item, `li-${blocks.length}-${index}`)}</li>)}</Tag>);
    list = null;
  };
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); return; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushList(); blocks.push(<h4 key={`h-${index}`} className={`model-answer-h level-${heading[1].length}`}>{inline(heading[2], `h-${index}`)}</h4>); return; }
    if (/^---+$/.test(line.trim())) { flushList(); blocks.push(<hr key={`hr-${index}`} />); return; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1]);
      return;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(ordered[1]);
      return;
    }
    flushList();
    blocks.push(<p key={`p-${index}`} className="model-answer-p">{inline(line, `p-${index}`)}</p>);
  });
  flushList();
  return <div className="model-answer">{blocks}</div>;
}

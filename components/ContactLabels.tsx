import React, { useId } from 'react';
import { contactInputClass } from './ContactPanel';

export default function ContactLabels({ tags, events, onTags, onEvents, knownEvents = [] }: {
  tags: string; events: string; onTags: (value: string) => void; onEvents: (value: string) => void; knownEvents?: string[];
}) {
  const id = useId();
  return <div className="space-y-3">
    <div><label htmlFor={`${id}-events`} className="block text-sm text-gray-300 mb-1">認識場合／活動</label><input id={`${id}-events`} list={`${id}-suggestions`} value={events} onChange={event => onEvents(event.target.value)} placeholder="例如：台北自動化展、朋友介紹" className={contactInputClass} /><datalist id={`${id}-suggestions`}>{knownEvents.map(value => <option key={value} value={value} />)}</datalist></div>
    <div><label htmlFor={`${id}-tags`} className="block text-sm text-gray-300 mb-1">標籤</label><input id={`${id}-tags`} value={tags} onChange={event => onTags(event.target.value)} placeholder="例如：供應商、潛在客戶、寄型錄" className={contactInputClass} /></div>
    <p className="text-xs text-gray-400">多個項目用逗號或頓號分隔，每個最多 80 字。</p>
  </div>;
}

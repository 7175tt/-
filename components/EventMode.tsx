import React, { useState } from 'react';
import ContactPanel, { contactButtonClass } from './ContactPanel';
import ContactLabels from './ContactLabels';
import { parseLabels, readContactMetadata } from '../services/contactMetadata';

export interface CaptureContext { tags: string[]; events: string[] }
export default function EventMode({ current, knownEvents, onSave, onClose }: {
  current: CaptureContext; knownEvents: string[]; onSave: (context: CaptureContext) => void; onClose: () => void;
}) {
  const [tags, setTags] = useState(current.tags.join('、'));
  const [events, setEvents] = useState(current.events.join('、'));
  const [error, setError] = useState('');
  return <ContactPanel title="活動模式" onClose={onClose}>
    <p className="text-sm text-gray-300 mb-5">接下來拍攝、選取照片或手動新增的名片，自動加入這些場合與標籤。已儲存的名片保持原樣；結束活動或重新整理頁面後停止套用。</p>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      try {
        const context = { tags: parseLabels(tags), events: parseLabels(events) };
        if (!context.events.length) throw new Error('請填寫這次活動或認識場合。');
        readContactMetadata(context); onSave(context); onClose();
      } catch (cause) { setError((cause as Error).message); }
    }}>
      <ContactLabels tags={tags} events={events} onTags={setTags} onEvents={setEvents} knownEvents={knownEvents} />
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <div className="flex gap-3"><button className={contactButtonClass} type="submit">套用到接下來的名片</button>{current.events.length > 0 && <button type="button" className="min-h-11 px-3 text-gray-300" onClick={() => { onSave({ tags: [], events: [] }); onClose(); }}>結束活動模式</button>}</div>
    </form>
  </ContactPanel>;
}

import React, { useState } from 'react';
import type { BusinessCard, FollowUp, Interaction } from '../types';
import { calendarLink, localDate, parseLabels } from '../services/contactMetadata';
import ContactPanel, { contactButtonClass, contactInputClass } from './ContactPanel';
import ContactLabels from './ContactLabels';

export default function ContactWorkspace({ card, sources, knownEvents, storageStatus, onChange, onRestore, onClose }: {
  card: BusinessCard; sources: BusinessCard[]; knownEvents: string[]; storageStatus: string;
  onChange: (change: (current: BusinessCard) => BusinessCard) => void; onRestore: (id: string) => void; onClose: () => void;
}) {
  const [tags, setTags] = useState((card.tags || []).join('、'));
  const [events, setEvents] = useState((card.events || []).join('、'));
  const [taskText, setTaskText] = useState('');
  const [dueDate, setDueDate] = useState(localDate());
  const [taskId, setTaskId] = useState<string | null>(null);
  const [interactionText, setInteractionText] = useState('');
  const [occurredOn, setOccurredOn] = useState(localDate());
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const change = (mutation: (current: BusinessCard) => BusinessCard, success: () => void = () => {}) => {
    try { onChange(mutation); setError(''); success(); }
    catch (cause) { setError((cause as Error).message); }
  };
  const tasks = [...(card.followUps || [])].sort((a, b) => Number(a.completedAt !== undefined) - Number(b.completedAt !== undefined) || a.dueDate.localeCompare(b.dueDate));
  return <ContactPanel title={`${card.name || card.company || '聯絡人'} · 跟進與紀錄`} onClose={onClose}>
    <p className="text-gray-400 mb-5 break-words">{[card.company, card.title].filter(Boolean).join(' · ')}</p>
    {error && <p role="alert" className="text-red-300 mb-3">{error}</p>}
    <p role="status" className="text-gray-400 text-xs mb-3">{storageStatus}</p>
    <details className="rounded-xl border border-gray-800 p-4 mb-5" open={!(card.tags?.length || card.events?.length)}>
      <summary className="cursor-pointer font-medium">場合與標籤{card.events?.length ? ` · ${card.events.join('、')}` : ''}</summary>
      <form className="space-y-3 mt-4" onSubmit={event => { event.preventDefault(); change(current => ({ ...current, tags: parseLabels(tags), events: parseLabels(events) })); }}>
        <ContactLabels tags={tags} events={events} onTags={setTags} onEvents={setEvents} knownEvents={knownEvents} />
        <button type="submit" className={contactButtonClass}>儲存場合與標籤</button>
      </form>
    </details>
    <section className="mb-7" aria-labelledby="follow-ups-title">
      <h2 id="follow-ups-title" className="text-lg font-semibold mb-3">跟進待辦</h2>
      <form className="space-y-3 rounded-xl bg-gray-900/60 p-3" onSubmit={event => {
        event.preventDefault();
        const task: FollowUp = { id: taskId || crypto.randomUUID(), text: taskText.trim(), dueDate, createdAt: Date.now() };
        change(current => ({ ...current, followUps: taskId ? (current.followUps || []).map(old => old.id === taskId ? { ...old, text: task.text, dueDate } : old) : [...(current.followUps || []), task] }), () => { setTaskText(''); setTaskId(null); });
      }}>
        <div><label htmlFor="follow-up-text" className="text-sm text-gray-300">下次要做什麼</label><input id="follow-up-text" required maxLength={2000} value={taskText} onChange={event => setTaskText(event.target.value)} placeholder="例如：寄產品型錄、確認報價" className={contactInputClass} /></div>
        <div><label htmlFor="follow-up-date" className="text-sm text-gray-300">預定日期</label><input id="follow-up-date" type="date" required min="1900-01-01" max="9998-12-31" value={dueDate} onChange={event => setDueDate(event.target.value)} className={contactInputClass} /></div>
        <div className="flex gap-3"><button className={contactButtonClass} type="submit">{taskId ? '儲存待辦' : '新增待辦'}</button>{taskId && <button type="button" className="min-h-11 px-3" onClick={() => { setTaskId(null); setTaskText(''); }}>取消編輯待辦</button>}</div>
      </form>
      <p className="text-xs text-gray-400 mt-2">需要手機提醒時，請加入 Google 行事曆並在行事曆內設定通知。App 內待辦與行事曆各自管理。</p>
      <ul className="divide-y divide-gray-800 mt-3">{tasks.map(task => <li key={task.id} className="py-3">
        <label className="flex gap-3 items-start min-h-11 cursor-pointer"><input type="checkbox" checked={task.completedAt !== undefined} onChange={() => change(current => ({ ...current, followUps: (current.followUps || []).map(item => item.id === task.id ? { ...item, completedAt: item.completedAt === undefined ? Date.now() : undefined } : item) }))} className="mt-1 h-5 w-5 shrink-0" aria-label={`完成待辦：${task.text}`} /><span className={`break-words min-w-0 ${task.completedAt !== undefined ? 'line-through text-gray-500' : ''}`}>{task.text}<span className={`block text-xs mt-1 ${task.completedAt === undefined && task.dueDate < localDate() ? 'text-amber-300' : 'text-gray-400'}`}>{task.completedAt !== undefined ? '已完成 · ' : task.dueDate < localDate() ? '已逾期 · ' : ''}{task.dueDate}</span></span></label>
        <div className="flex flex-wrap gap-3 ml-8"><button className="min-h-11 text-sm text-blue-300" onClick={() => { setTaskId(task.id); setTaskText(task.text); setDueDate(task.dueDate); document.getElementById('follow-up-text')?.focus(); }} aria-label={`編輯待辦：${task.text}`}>編輯</button>{task.completedAt === undefined && <a href={calendarLink(card, task)} target="_blank" rel="noopener noreferrer" className="min-h-11 inline-flex items-center text-sm text-blue-300">加入 Google 行事曆</a>}</div>
      </li>)}</ul>
      {!tasks.length && <p className="text-sm text-gray-500 mt-3">還沒有待辦，先記下一件想跟進的事。</p>}
    </section>
    <section aria-labelledby="interactions-title">
      <h2 id="interactions-title" className="text-lg font-semibold mb-3">互動紀錄</h2>
      <form className="space-y-3 rounded-xl bg-gray-900/60 p-3" onSubmit={event => {
        event.preventDefault();
        const entry: Interaction = { id: interactionId || crypto.randomUUID(), text: interactionText.trim(), occurredOn, createdAt: Date.now() };
        change(current => ({ ...current, interactions: interactionId ? (current.interactions || []).map(old => old.id === interactionId ? { ...old, text: entry.text, occurredOn } : old) : [...(current.interactions || []), entry] }), () => { setInteractionText(''); setInteractionId(null); });
      }}>
        <div><label htmlFor="interaction-date" className="text-sm text-gray-300">互動日期</label><input id="interaction-date" type="date" required min="1900-01-01" max="9998-12-31" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} className={contactInputClass} /></div>
        <div><label htmlFor="interaction-text" className="text-sm text-gray-300">這次聊了什麼</label><textarea id="interaction-text" required maxLength={2000} rows={3} value={interactionText} onChange={event => setInteractionText(event.target.value)} placeholder="例如：對方想了解視覺檢測方案，下週提供案例。" className={contactInputClass} /></div>
        <div className="flex gap-3"><button className={contactButtonClass} type="submit">{interactionId ? '儲存互動紀錄' : '新增互動紀錄'}</button>{interactionId && <button type="button" className="min-h-11 px-3" onClick={() => { setInteractionId(null); setInteractionText(''); }}>取消編輯紀錄</button>}</div>
      </form>
      <ol className="divide-y divide-gray-800 mt-3">{[...(card.interactions || [])].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt - a.createdAt).map(entry => <li key={entry.id} className="py-3"><time className="text-sm text-blue-300">{entry.occurredOn}</time><p className="mt-1 whitespace-pre-wrap break-words">{entry.text}</p><button className="min-h-11 text-sm text-gray-400" onClick={() => { setInteractionId(entry.id); setInteractionText(entry.text); setOccurredOn(entry.occurredOn); document.getElementById('interaction-text')?.focus(); }} aria-label={`編輯紀錄：${entry.text}`}>編輯</button></li>)}</ol>
    </section>
    {sources.length > 0 && <details className="mt-6 border border-gray-800 p-3 rounded-xl"><summary className="cursor-pointer">查看合併前的 {sources.length} 張名片</summary><p className="text-xs text-gray-400 mt-3">原始資料仍保留在備份與雲端。還原會重新顯示該張名片，合併結果也會保留。</p>{sources.map(source => <div key={source.id} className="border-t border-gray-800 py-4 mt-3"><h3 className="font-bold">{source.name || source.company}</h3><p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{[source.company, source.title, source.phone, source.email, source.address, source.notes, source.rawText, ...(source.tags || []), ...(source.events || [])].filter(Boolean).join('\n')}</p><button className="min-h-11 text-blue-300 text-sm" onClick={() => onRestore(source.id)} aria-label={`還原原始名片：${source.name || source.company}`}>還原這張名片</button></div>)}</details>}
  </ContactPanel>;
}

import React, { useState } from 'react';
import type { BusinessCard } from '../types';
import { localDate, pendingFollowUps } from '../services/contactMetadata';
import ContactPanel from './ContactPanel';

export default function FollowUpBoard({ cards, onOpen, onComplete, onClose }: {
  cards: BusinessCard[]; onOpen: (id: string) => void; onComplete: (cardId: string, taskId: string) => void; onClose: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const today = localDate();
  const tasks = cards.flatMap(card => pendingFollowUps(card).map(task => ({ card, task }))).sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate));
  const filtered = tasks.filter(({ task }) => filter === 'all' || (filter === 'today' ? task.dueDate === today : filter === 'overdue' ? task.dueDate < today : task.dueDate > today));
  return <ContactPanel title={`待跟進 · ${tasks.length} 件`} onClose={onClose}>
    <div className="flex flex-wrap gap-2 mb-4">{Object.entries({ all: '全部', overdue: '已逾期', today: '今天', upcoming: '之後' }).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-11 px-3 rounded-lg ${filter === value ? 'bg-blue-600' : 'bg-gray-800'}`}>{label}</button>)}</div>
    <ul className="space-y-3">{filtered.map(({ card, task }) => <li key={`${card.id}:${task.id}`} className="bg-gray-900 rounded-xl p-4"><button onClick={() => onOpen(card.id)} className="w-full text-left"><span className="block text-sm text-blue-300">{card.name || card.company} · {card.company}</span><span className="block font-medium mt-2 break-words">{task.text}</span><span className={`block text-sm mt-1 ${task.dueDate < today ? 'text-amber-300' : 'text-gray-400'}`}>{task.dueDate < today ? '已逾期 · ' : ''}{task.dueDate}</span></button><button className="min-h-11 mt-2 text-sm text-emerald-300" aria-label={`完成待辦：${task.text}`} onClick={() => onComplete(card.id, task.id)}>標記完成</button></li>)}</ul>
    {!filtered.length && <p className="text-gray-400 py-8 text-center">這個範圍沒有待跟進事項。可在名片的「跟進與紀錄」新增。</p>}
  </ContactPanel>;
}

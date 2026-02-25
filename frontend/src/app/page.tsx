'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Booking {
  _id: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
}

interface Task {
  _id: string;
  title: string;
  priority: string;
  completed: boolean;
  dueDate: string | null;
}

interface Escalation {
  _id: string;
  reason: string;
  status: string;
  createdAt: string;
}

export default function Home() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);

  useEffect(() => {
    const now = new Date();
    fetch(`/api/bookings/${now.getFullYear()}/${now.getMonth() + 1}`)
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setBookings(d); }).catch(() => { });
    fetch('/api/planner/tasks')
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setTasks(d); }).catch(() => { });
    fetch('/api/escalations')
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setEscalations(d); }).catch(() => { });
  }, []);

  const todayBookings = bookings.filter(b => {
    const today = new Date();
    const ci = new Date(b.checkIn);
    const co = new Date(b.checkOut);
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    return ci <= dayEnd && co >= dayStart;
  });

  const activeTasks = tasks.filter(t => !t.completed);
  const pendingEscalations = escalations.filter(e => e.status === 'pending');

  const statCards = [
    {
      title: 'Today\'s Bookings',
      value: todayBookings.length,
      icon: '🏨',
      color: 'from-emerald-500 to-teal-600',
      link: '/calendar'
    },
    {
      title: 'Active Tasks',
      value: activeTasks.length,
      icon: '📋',
      color: 'from-violet-500 to-purple-600',
      link: '/planner'
    },
    {
      title: 'Pending Alerts',
      value: pendingEscalations.length,
      icon: '🔔',
      color: 'from-amber-500 to-orange-600',
      link: '/notifications'
    },
    {
      title: 'Total Bookings',
      value: bookings.length,
      icon: '📊',
      color: 'from-blue-500 to-indigo-600',
      link: '/calendar'
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Dashboard
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Welcome back. Here&apos;s your overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {statCards.map((card) => (
          <Link key={card.title} href={card.link}
            className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 hover:shadow-lg transition-all group">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center text-lg mb-3 group-hover:scale-110 transition-transform`}>
              {card.icon}
            </div>
            <p className="text-2xl md:text-3xl font-bold">{card.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{card.title}</p>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 p-4 md:p-6">
        <h2 className="font-semibold text-sm mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Command Center', href: '/orchestrator', icon: '🧠', desc: 'AI Orchestrator' },
            { label: 'New Booking', href: '/agent', icon: '➕', desc: 'Via Booking Agent' },
            { label: 'Plan Tasks', href: '/planner', icon: '📝', desc: 'AI Planner' },
            { label: 'View Calendar', href: '/calendar', icon: '📅', desc: 'Reservations' },
          ].map((action) => (
            <Link key={action.label} href={action.href}
              className="flex flex-col items-center p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-center group">
              <span className="text-2xl mb-1 group-hover:scale-110 transition-transform">{action.icon}</span>
              <span className="text-xs font-semibold">{action.label}</span>
              <span className="text-[10px] text-gray-400">{action.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Today's Bookings */}
      {todayBookings.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="font-semibold text-sm">Today&apos;s Guests</h2>
            <Link href="/calendar" className="text-xs text-blue-500 hover:text-blue-600">View all →</Link>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-zinc-800">
            {todayBookings.slice(0, 5).map(b => (
              <div key={b._id} className="px-4 md:px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{b.guestName}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(b.checkIn).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })} →{' '}
                    {new Date(b.checkOut).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">Active</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Tasks Preview */}
      {activeTasks.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="font-semibold text-sm">Active Tasks</h2>
            <Link href="/planner" className="text-xs text-violet-500 hover:text-violet-600">Manage →</Link>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-zinc-800">
            {activeTasks.slice(0, 4).map(t => (
              <div key={t._id} className="px-4 md:px-6 py-3 flex items-center justify-between">
                <p className="text-sm">{t.title}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : t.priority === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>{t.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
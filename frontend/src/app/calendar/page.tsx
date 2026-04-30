'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Task {
    _id: string;
    title: string;
    description: string;
    dueDate: string | null;
    priority: 'low' | 'medium' | 'high';
    completed: boolean;
}

const priorityColors: Record<string, string> = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function CalendarPage() {
    const [date, setDate] = useState(new Date());
    const [tasks, setTasks] = useState<Task[]>([]);
    const [selectedDay, setSelectedDay] = useState<number | null>(null);
    const [, setLoading] = useState(false);

    const year = date.getFullYear();
    const month = date.getMonth();

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.get<Task[]>('/api/planner/tasks');
            if (Array.isArray(data)) setTasks(data);
        } catch (err) {
            console.error('Failed to fetch tasks:', err);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();

    const handlePrevMonth = () => { setDate(new Date(year, month - 1, 1)); setSelectedDay(null); };
    const handleNextMonth = () => { setDate(new Date(year, month + 1, 1)); setSelectedDay(null); };

    const getTasksForDay = (day: number) => {
        return tasks.filter(t => {
            if (!t.dueDate) return false;
            const dd = new Date(t.dueDate);
            return dd.getDate() === day && dd.getMonth() === month && dd.getFullYear() === year;
        });
    };

    const isToday = (day: number) => {
        const today = new Date();
        return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    };

    const toggleTask = async (id: string, completed: boolean) => {
        await api.patch(`/api/planner/tasks/${id}`, { completed: !completed });
        fetchTasks();
    };

    const deleteTask = async (id: string) => {
        if (!confirm('Ștergi acest task?')) return;
        await api.delete(`/api/planner/tasks/${id}`);
        fetchTasks();
    };

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNamesShort = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const selectedTasks = selectedDay ? getTasksForDay(selectedDay) : [];

    // Count tasks without dueDate for display
    const unscheduledTasks = tasks.filter(t => !t.dueDate && !t.completed);

    const renderCalendar = () => {
        const calendarDays = [];
        for (let i = 0; i < firstDayOfMonth; i++) {
            calendarDays.push(<div key={`empty-${i}`} className="rounded-lg min-h-[2.5rem] md:min-h-[5rem]"></div>);
        }
        for (let day = 1; day <= daysInMonth; day++) {
            const dayTasks = getTasksForDay(day);
            const hasTasks = dayTasks.length > 0;
            const pendingCount = dayTasks.filter(t => !t.completed).length;
            const today = isToday(day);
            const isSelected = selectedDay === day;
            calendarDays.push(
                <div key={day} onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                    className={`rounded-lg p-1 md:p-2 min-h-[2.5rem] md:min-h-[5rem] cursor-pointer transition-all duration-200 border
            ${isSelected ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-500 ring-2 ring-blue-400/50 shadow-md'
                            : today ? 'bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border-blue-300 dark:border-blue-700'
                                : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm'}`}>
                    <div className="flex items-center justify-between">
                        <span className={`text-xs md:text-sm font-semibold ${today ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>{day}</span>
                        {hasTasks && (
                            <span className={`text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${pendingCount > 0 ? 'bg-teal-500 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-500'}`}>
                                {dayTasks.length}
                            </span>
                        )}
                    </div>
                    <div className="hidden md:block mt-1 space-y-0.5">
                        {dayTasks.slice(0, 2).map((t) => (
                            <div key={t._id} className={`text-[10px] rounded px-1 py-0.5 truncate font-medium ${t.completed ? 'bg-gray-100 dark:bg-zinc-800 text-gray-400 line-through' : 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300'}`}>
                                {t.title}
                            </div>
                        ))}
                        {dayTasks.length > 2 && <div className="text-[10px] text-gray-400">+{dayTasks.length - 2} more</div>}
                    </div>
                </div>
            );
        }
        return calendarDays;
    };

    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="h-full flex flex-col gap-4 md:gap-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Calendar</h1>
                <div className="flex items-center gap-2">
                    <Link
                        href="/planner"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/20 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-400 font-medium transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
                        Planner
                    </Link>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{tasks.filter(t => !t.completed).length} active tasks</span>
                </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
                <div className="flex justify-between items-center px-4 md:px-6 py-3 md:py-4 bg-gradient-to-r from-blue-600 to-purple-600">
                    <button onClick={handlePrevMonth} className="text-white/80 hover:text-white p-1.5 md:p-2 rounded-lg hover:bg-white/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <h2 className="text-base md:text-lg font-bold text-white tracking-wide">{date.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                    <button onClick={handleNextMonth} className="text-white/80 hover:text-white p-1.5 md:p-2 rounded-lg hover:bg-white/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                </div>
                <div className="grid grid-cols-7 text-center border-b border-gray-100 dark:border-zinc-800">
                    {dayNames.map((name, idx) => (
                        <div key={name + idx} className="py-2 md:py-3">
                            <span className="hidden md:inline text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{name}</span>
                            <span className="md:hidden text-xs font-semibold text-gray-500 dark:text-gray-400">{dayNamesShort[idx]}</span>
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1 md:gap-2 p-2 md:p-4">{renderCalendar()}</div>
            </div>

            {/* Day Detail Panel */}
            {selectedDay && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                        <h3 className="font-bold text-base md:text-lg">{selectedDay} {date.toLocaleString('default', { month: 'long' })} {year}</h3>
                        <button onClick={() => setSelectedDay(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    </div>
                    <div className="p-4 md:p-6">
                        {selectedTasks.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">Niciun task pentru această zi.</p>
                        ) : (
                            <div className="space-y-2">
                                {selectedTasks.map((t) => (
                                    <div key={t._id} className={`flex items-start gap-3 bg-gray-50 dark:bg-zinc-800/50 rounded-xl p-3 ${t.completed ? 'opacity-60' : ''}`}>
                                        <button onClick={() => toggleTask(t._id, t.completed)}
                                            className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors
                                            ${t.completed ? 'bg-teal-500 border-teal-500 text-white' : 'border-gray-300 dark:border-zinc-600 hover:border-teal-500'}`}>
                                            {t.completed && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-medium text-sm ${t.completed ? 'line-through text-gray-400' : ''}`}>{t.title}</p>
                                            {t.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</p>}
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityColors[t.priority]}`}>{t.priority}</span>
                                                {t.dueDate && <span className="text-[10px] text-gray-400">⏰ {formatTime(t.dueDate)}</span>}
                                            </div>
                                        </div>
                                        <button onClick={() => deleteTask(t._id)} className="text-gray-300 hover:text-red-500 transition-colors p-1 flex-shrink-0" title="Șterge">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Unscheduled Tasks */}
            {unscheduledTasks.length > 0 && !selectedDay && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 md:px-6 py-3 border-b border-gray-100 dark:border-zinc-800">
                        <h3 className="font-semibold text-sm">📋 Fără dată ({unscheduledTasks.length})</h3>
                    </div>
                    <div className="p-3 space-y-1.5">
                        {unscheduledTasks.map(t => (
                            <div key={t._id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                                <button onClick={() => toggleTask(t._id, t.completed)}
                                    className="w-4 h-4 rounded border-2 flex-shrink-0 border-gray-300 dark:border-zinc-600 hover:border-teal-500 transition-colors" />
                                <span className="text-sm flex-1 truncate">{t.title}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityColors[t.priority]}`}>{t.priority}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

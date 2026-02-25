'use client';

import { useState, useEffect } from 'react';

interface Booking {
  _id: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
}

export default function Home() {
  const [date, setDate] = useState(new Date());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const year = date.getFullYear();
  const month = date.getMonth();

  useEffect(() => {
    fetchBookings();
  }, [year, month]);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings/${year}/${month + 1}`);
      const data = await res.json();
      setBookings(data);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    }
    setLoading(false);
  };

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    setDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    setDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

  const getBookingsForDay = (day: number) => {
    const dayStart = new Date(year, month, day, 0, 0, 0);
    const dayEnd = new Date(year, month, day, 23, 59, 59);
    return bookings.filter(b => {
      const ci = new Date(b.checkIn);
      const co = new Date(b.checkOut);
      return ci <= dayEnd && co >= dayStart;
    });
  };

  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const handleDeleteBooking = async (id: string) => {
    if (!confirm('Sigur vrei să anulezi această rezervare?')) return;
    try {
      await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      fetchBookings();
    } catch (err) {
      console.error('Failed to delete booking:', err);
    }
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNamesShort = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

  const selectedBookings = selectedDay ? getBookingsForDay(selectedDay) : [];

  const renderCalendar = () => {
    const calendarDays = [];

    for (let i = 0; i < firstDayOfMonth; i++) {
      calendarDays.push(
        <div key={`empty-${i}`} className="rounded-lg min-h-[2.5rem] md:min-h-[5rem]"></div>
      );
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayBookings = getBookingsForDay(day);
      const hasBookings = dayBookings.length > 0;
      const today = isToday(day);
      const isSelected = selectedDay === day;

      calendarDays.push(
        <div
          key={day}
          onClick={() => setSelectedDay(day === selectedDay ? null : day)}
          className={`
            rounded-lg p-1 md:p-2 min-h-[2.5rem] md:min-h-[5rem] cursor-pointer transition-all duration-200 border
            ${isSelected
              ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-500 ring-2 ring-blue-400/50 shadow-md'
              : today
                ? 'bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border-blue-300 dark:border-blue-700'
                : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm'
            }
          `}
        >
          <div className="flex items-center justify-between">
            <span className={`
              text-xs md:text-sm font-semibold
              ${today ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}
            `}>
              {day}
            </span>
            {hasBookings && (
              <span className="flex gap-0.5">
                {dayBookings.slice(0, 3).map((_, idx) => (
                  <span key={idx} className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 inline-block" />
                ))}
              </span>
            )}
          </div>
          {/* Desktop: show booking names */}
          <div className="hidden md:block mt-1 space-y-0.5">
            {dayBookings.slice(0, 2).map((b) => (
              <div key={b._id} className="text-[10px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 rounded px-1 py-0.5 truncate font-medium">
                {b.guestName}
              </div>
            ))}
            {dayBookings.length > 2 && (
              <div className="text-[10px] text-gray-400">+{dayBookings.length - 2} more</div>
            )}
          </div>
        </div>
      );
    }

    return calendarDays;
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-full flex flex-col gap-4 md:gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Reservations
        </h1>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          <span>Booked</span>
        </div>
      </div>

      {/* Calendar Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
        {/* Month Navigation */}
        <div className="flex justify-between items-center px-4 md:px-6 py-3 md:py-4 bg-gradient-to-r from-blue-600 to-purple-600">
          <button onClick={handlePrevMonth} className="text-white/80 hover:text-white p-1.5 md:p-2 rounded-lg hover:bg-white/10 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <h2 className="text-base md:text-lg font-bold text-white tracking-wide">
            {date.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={handleNextMonth} className="text-white/80 hover:text-white p-1.5 md:p-2 rounded-lg hover:bg-white/10 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>

        {/* Day Names */}
        <div className="grid grid-cols-7 text-center border-b border-gray-100 dark:border-zinc-800">
          {dayNames.map((name, idx) => (
            <div key={name + idx} className="py-2 md:py-3">
              <span className="hidden md:inline text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{name}</span>
              <span className="md:hidden text-xs font-semibold text-gray-500 dark:text-gray-400">{dayNamesShort[idx]}</span>
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 md:gap-2 p-2 md:p-4">
          {renderCalendar()}
        </div>
      </div>

      {/* Selected Day Details */}
      {selectedDay && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800 overflow-hidden animate-in slide-in-from-top-2">
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
            <h3 className="font-bold text-base md:text-lg">
              {selectedDay} {date.toLocaleString('default', { month: 'long' })} {year}
            </h3>
            <button onClick={() => setSelectedDay(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
          <div className="p-4 md:p-6">
            {selectedBookings.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                No reservations for this day.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedBookings.map((b) => (
                  <div key={b._id} className="flex items-start justify-between bg-gray-50 dark:bg-zinc-800/50 rounded-xl p-3 md:p-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm md:text-base truncate">{b.guestName}</p>
                      <div className="flex flex-col sm:flex-row sm:gap-4 text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-1">
                        <span>📥 Check-in: {formatDateTime(b.checkIn)}</span>
                        <span>📤 Check-out: {formatDateTime(b.checkOut)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteBooking(b._id)}
                      className="ml-2 text-red-400 hover:text-red-600 transition-colors p-1 flex-shrink-0"
                      title="Cancel booking"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
'use client';

import { useState } from 'react';

export default function Home() {
  const [date, setDate] = useState(new Date());

  const daysInMonth = () => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month + 1, 0).getDate();
  };

  const firstDayOfMonth = () => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    setDate(new Date(date.getFullYear(), date.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setDate(new Date(date.getFullYear(), date.getMonth() + 1, 1));
  };

  const renderCalendar = () => {
    const totalDays = daysInMonth();
    const startDay = firstDayOfMonth();
    const calendarDays = [];

    for (let i = 0; i < startDay; i++) {
      calendarDays.push(<div key={`empty-${i}`} className="border rounded-lg p-4 h-24"></div>);
    }

    for (let day = 1; day <= totalDays; day++) {
      calendarDays.push(
        <div key={day} className="border rounded-lg p-4 h-24 cursor-pointer hover:bg-gray-100">
          {day}
        </div>
      );
    }

    return calendarDays;
  };

  return (
    <div className="h-full flex flex-col p-6">
      <h1 className="text-3xl font-bold tracking-tight mb-8 text-center">Book a Reservation</h1>
      <div className="bg-white rounded-2xl shadow-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <button onClick={handlePrevMonth} className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Prev</button>
          <h2 className="text-xl font-semibold">{date.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
          <button onClick={handleNextMonth} className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Next</button>
        </div>
        <div className="grid grid-cols-7 gap-4 text-center font-semibold text-gray-600">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-4 mt-4">
          {renderCalendar()}
        </div>
      </div>
    </div>
  );
}
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, MessageCircle, User, Home, BarChart2, Bell, Brain, CalendarCheck, Calendar } from 'lucide-react';

const navItems = [
  { href: '/', icon: Home, label: 'Home', showOnMobile: true },
  { href: '/orchestrator', icon: Brain, label: 'Command', showOnMobile: true },
  { href: '/planner', icon: CalendarCheck, label: 'Planner', showOnMobile: true },
  { href: '/whatsapp', icon: MessageCircle, label: 'WhatsApp', showOnMobile: false },
  { href: '/analytics', icon: BarChart2, label: 'Analytics', showOnMobile: false },
  { href: '/notifications', icon: Bell, label: 'Alerts', showOnMobile: false },
  { href: '/agent', icon: User, label: 'Booking', showOnMobile: false },
  { href: '/calendar', icon: Calendar, label: 'Calendar', showOnMobile: true },
  { href: '/settings', icon: Settings, label: 'Settings', showOnMobile: true },
];

export default function Navigation() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
          console.error('Service Worker registration failed:', err);
        });
      });
    }
  }, []);

  return (
    <>
      {/* Mobile Bottom Navigation (Hidden on md and larger screens) */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white dark:bg-black border-t border-gray-200 dark:border-gray-800 pb-safe z-50">
        <div className="flex justify-around items-center h-16 w-full px-2">
          {navItems.filter(item => item.showOnMobile).map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive ? 'text-blue-600 dark:text-blue-500' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}`}
              >
                <Icon size={24} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Tablet/Desktop Side Navigation (Visible on md and larger screens) */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-gray-50 dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 z-40">
        <div className="p-6">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">USA App</h2>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${isActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-semibold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-200'}`}
              >
                <Icon size={20} className={isActive ? 'text-blue-600 dark:text-blue-400' : ''} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-zinc-800">
          <div className="flex items-center space-x-3 px-2 py-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
              U
            </div>
            <div>
              <p className="text-sm font-semibold">User Account</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Admin</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

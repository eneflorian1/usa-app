export default function AnalyticsPage() {
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-6">Analytics Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Users</h3>
          <p className="text-3xl font-bold">1,248</p>
          <p className="text-xs text-green-500 mt-2 flex items-center">↑ 12% from last month</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Active Sessions</h3>
          <p className="text-3xl font-bold">412</p>
          <p className="text-xs text-green-500 mt-2 flex items-center">↑ 5% from last week</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Messages Sent</h3>
          <p className="text-3xl font-bold">8,930</p>
          <p className="text-xs text-red-500 mt-2 flex items-center">↓ 2% from yesterday</p>
        </div>
      </div>
      <div className="flex-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm min-h-[300px] flex items-center justify-center">
        <p className="text-gray-400">Chart visualization goes here...</p>
      </div>
    </div>
  );
}
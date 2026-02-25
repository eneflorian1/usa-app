export default function NotificationsPage() {
  return (
    <div className="h-full flex flex-col">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-6">System Alerts</h1>
      <div className="space-y-4">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex gap-4">
          <div className="w-2 h-2 rounded-full bg-blue-500 mt-2"></div>
          <div>
            <h3 className="font-semibold text-blue-900 dark:text-blue-200">New Feature Deployed</h3>
            <p className="text-sm text-blue-800/80 dark:text-blue-300/80 mt-1">The responsive layout is now active for foldable devices.</p>
            <p className="text-xs text-blue-600/60 dark:text-blue-400/60 mt-2">2 minutes ago</p>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 flex gap-4">
          <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-zinc-600 mt-2"></div>
          <div>
            <h3 className="font-semibold">Weekly Report Ready</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Your analytics report for the previous week has been generated.</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Yesterday</p>
          </div>
        </div>
      </div>
    </div>
  );
}
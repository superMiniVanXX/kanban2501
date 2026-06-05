import { Link, useLocation, Outlet } from 'react-router-dom';
import SearchBox from './SearchBox';
import RecentTasks from './RecentTasks';

export default function Layout({ children }: { children?: React.ReactNode }) {
  const location = useLocation();

  const navLinks = [
    { to: '/', label: 'Projects' },
    { to: '/statistics', label: 'Statistics' },
    { to: '/settings', label: 'Settings' },
    { to: '/trash', label: 'Trash' },
  ];

  return (
    <div className="h-full flex flex-col">
      <header className="bg-gray-900 px-6 py-3 flex items-center justify-between flex-shrink-0 shadow-lg shadow-gray-900/10 gap-6">
        <Link to="/" className="text-xl font-bold text-white tracking-tight hover:text-blue-300 transition-colors flex-shrink-0">
          Kanban<span className="text-blue-400">-PMP</span>
        </Link>
        <div className="flex-1 flex justify-center">
          <SearchBox />
        </div>
        <div className="flex items-center flex-shrink-0">
          <RecentTasks />
        </div>
        <nav className="flex items-center gap-1 flex-shrink-0">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-white bg-white/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 min-h-0 px-6 py-4">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}

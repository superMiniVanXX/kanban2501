import { Link, Outlet } from 'react-router-dom';

export default function Layout({ children }: { children?: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <Link to="/" className="text-xl font-bold text-gray-800 tracking-tight">
          Kanban-PMP
        </Link>
        <nav className="text-sm text-gray-500">
          <Link to="/" className="hover:text-gray-800">Projects</Link>
        </nav>
      </header>
      <main className="flex-1 min-h-0 px-6 py-4">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}

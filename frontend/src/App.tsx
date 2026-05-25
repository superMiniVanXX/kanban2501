import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProjectList from './pages/ProjectList';
import KanbanBoard from './pages/KanbanBoard';
import SettingsPage from './pages/SettingsPage';
import StatisticsPage from './pages/StatisticsPage';
import TrashPage from './pages/TrashPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/:id/board" element={<KanbanBoard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/statistics" element={<StatisticsPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

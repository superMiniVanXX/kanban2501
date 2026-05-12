import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProjectList from './pages/ProjectList';
import KanbanBoard from './pages/KanbanBoard';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/:id/board" element={<KanbanBoard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

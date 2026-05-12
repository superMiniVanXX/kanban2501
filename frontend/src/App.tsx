import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProjectList from './pages/ProjectList';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

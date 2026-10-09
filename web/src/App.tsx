import { Route, Routes } from 'react-router';
import { CheckinPage } from './pages/CheckinPage';
import { HomePage } from './pages/HomePage';
import { InstructorPage } from './pages/InstructorPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotRegisteredPage } from './pages/NotRegisteredPage';
import { ProjectorPage } from './pages/ProjectorPage';
import { RosterPage } from './pages/RosterPage';
import { Layout } from './ui';

// Which page shows for which URL. Pages inside <Layout> get the header.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="not-registered" element={<NotRegisteredPage />} />
        <Route path="instructor" element={<InstructorPage />} />
        <Route path="checkin" element={<CheckinPage />} />
        <Route path="roster/:id" element={<RosterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* The projector is full screen, so it sits outside the Layout. */}
      <Route path="projector/:id" element={<ProjectorPage />} />
    </Routes>
  );
}

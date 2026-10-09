import { Route, Routes } from 'react-router';
import { CheckinPage } from './pages/CheckinPage';
import { DevPage } from './pages/DevPage';
import { HomePage } from './pages/HomePage';
import { InstructorPage } from './pages/InstructorPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotRegisteredPage } from './pages/NotRegisteredPage';
import { ProjectorPage } from './pages/ProjectorPage';
import { RosterPage } from './pages/RosterPage';
import { SessionPage } from './pages/SessionPage';
import { StudentClassesPage } from './pages/StudentClassesPage';
import { StudentClassPage } from './pages/StudentClassPage';
import { StudentOverviewPage } from './pages/StudentOverviewPage';
import { SummaryPage } from './pages/SummaryPage';
import { Layout, StudentLayout } from './ui';

// Which page shows for which URL. There are two flows (see docs/SCREENS.md):
//   instructor: /  →  /instructor  →  /session/:id  →  /summary/:id
//   student:    QR →  /checkin,  and  /student (their classes)
export function App() {
  return (
    <Routes>
      {/* Sign in. After login the API sends each person to their home (task Y1). */}
      <Route index element={<HomePage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="not-registered" element={<NotRegisteredPage />} />

      {/* Instructor screens share the slim top bar (Layout). */}
      <Route element={<Layout />}>
        <Route path="instructor" element={<InstructorPage />} />
        <Route path="session/:id" element={<SessionPage />} />
        <Route path="summary/:id" element={<SummaryPage />} />
      </Route>
      {/* Full screen for the projector, so it sits outside the Layout. */}
      <Route path="projector/:id" element={<ProjectorPage />} />
      <Route path="roster/:id" element={<RosterPage />} />

      {/* Students: check-in is its own screen (they arrive from the QR);
          the rest share the bottom tab bar (StudentLayout). */}
      <Route path="checkin" element={<CheckinPage />} />
      <Route path="student" element={<StudentLayout />}>
        <Route index element={<StudentClassesPage />} />
        <Route path="overview" element={<StudentOverviewPage />} />
        <Route path="class/:id" element={<StudentClassPage />} />
      </Route>

      {/* Temporary list of every screen, until sign-in works. */}
      <Route path="dev" element={<DevPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

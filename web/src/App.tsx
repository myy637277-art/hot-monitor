import { Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell.tsx';
import { HotFeedPage } from './pages/HotFeedPage.tsx';
import { DigestPage, DiscoverPage, NotFoundPage } from './pages/PlaceholderPages.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { WatchPage } from './pages/WatchPage.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HotFeedPage />} />
        <Route path="watch" element={<WatchPage />} />
        <Route path="digest" element={<DigestPage />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

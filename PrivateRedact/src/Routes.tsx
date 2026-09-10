import { Route, Routes } from 'react-router'
import { Home } from './pages/Home';
import Redact from './pages/Redact';
import { Layout } from './components/Layout';

export function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path='/redact' element={<Redact />} />
      </Routes>
    </Layout>
  )
}

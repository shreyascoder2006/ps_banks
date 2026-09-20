import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import { RealtimeProvider } from './lib/realtime';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Pulse from './pages/Pulse';
import Segments from './pages/Segments';
import Forecast from './pages/Forecast';
import ProductTrends from './pages/ProductTrends';
import MarketSentiment from './pages/MarketSentiment';
import Complaints from './pages/Complaints';
import Assistant from './pages/Assistant';
import Blockchain from './pages/Blockchain';
import ComplaintInsights from './pages/ComplaintInsights';
import Customer360 from './pages/Customer360';
import Outreach from './pages/Outreach';

function Protected({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <RealtimeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><Overview /></Protected>} />
          <Route path="/pulse" element={<Protected><Pulse /></Protected>} />
          <Route path="/customers/:id" element={<Protected><Customer360 /></Protected>} />
          <Route path="/outreach" element={<Protected><Outreach /></Protected>} />
          <Route path="/segments" element={<Protected><Segments /></Protected>} />
          <Route path="/forecast" element={<Protected><Forecast /></Protected>} />
          <Route path="/trends" element={<Protected><ProductTrends /></Protected>} />
          <Route path="/sentiment" element={<Protected><MarketSentiment /></Protected>} />
          <Route path="/complaints" element={<Protected><Complaints /></Protected>} />
          <Route path="/complaints/insights" element={<Protected><ComplaintInsights /></Protected>} />
          <Route path="/assistant" element={<Protected><Assistant /></Protected>} />
          <Route path="/blockchain" element={<Protected><Blockchain /></Protected>} />
        </Routes>
      </BrowserRouter>
      </RealtimeProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

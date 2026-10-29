import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import { RealtimeProvider } from './lib/realtime';
import StoryMode from './components/StoryMode';
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
import FrontlineAssist from './pages/FrontlineAssist';
import Outreach from './pages/Outreach';

function Protected({ children }) {
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <ToastProvider>
    <RealtimeProvider>
    <BrowserRouter>
      <StoryMode />
      <Routes>
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
        <Route path="/frontline" element={<Protected><FrontlineAssist /></Protected>} />
        <Route path="/blockchain" element={<Protected><Blockchain /></Protected>} />
      </Routes>
    </BrowserRouter>
    </RealtimeProvider>
    </ToastProvider>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles.css';
import CreateScreen from './CreateScreen.jsx';
import ShareScreen from './ShareScreen.jsx';
import CardScreen from './CardScreen.jsx';
import { Analytics } from '@vercel/analytics/react';
import { initAnalytics } from './lib/analytics.js';

// GA4 (src/lib/analytics.js) — unchanged, runs alongside Vercel Analytics.
initAnalytics();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateScreen />} />
        <Route path="/share/:id" element={<ShareScreen />} />
        <Route path="/c/:id" element={<CardScreen />} />
      </Routes>
      {/* Vercel Web Analytics — cookieless, zero-config, only sends on a
          Vercel deployment. Additive to GA4, not a replacement. */}
      <Analytics />
    </BrowserRouter>
  </React.StrictMode>
);

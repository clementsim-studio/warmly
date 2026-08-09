import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles.css';
import CreateScreen from './CreateScreen.jsx';
import ShareScreen from './ShareScreen.jsx';
import CardScreen from './CardScreen.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateScreen />} />
        <Route path="/share/:id" element={<ShareScreen />} />
        <Route path="/c/:id" element={<CardScreen />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

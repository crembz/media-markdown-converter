// MUST stay first — installs Promise.try for pdfjs-dist before the App import
// chain pulls pdfjs in. See src/polyfills.ts for why it can't live here.
import './polyfills';

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

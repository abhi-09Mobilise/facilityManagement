import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Tailwind + shadcn tokens. Loaded once at app boot so utility classes work
// everywhere. Order matters: this must come before App so its `@layer base`
// reset applies before any MUI defaults set their own.
import './styles/globals.css';
import './styles/components.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

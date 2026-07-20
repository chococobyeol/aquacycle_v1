import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/global.css';
import './styles/v2.css';

const root = document.getElementById('root');

if (!root) throw new Error('AquaCycle root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

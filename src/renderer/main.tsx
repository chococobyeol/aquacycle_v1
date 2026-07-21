import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/global.css';
import './styles/v2.css';

const root = document.getElementById('root');

if (!root) throw new Error('AquaCycle root element is missing.');

// Pixi owns an imperative WebGL renderer. React StrictMode deliberately mounts,
// tears down, and mounts effects again in development; that creates two Pixi
// Applications concurrently while the first async initialization is still in
// flight. Pixi Applications share renderer resources, so destroying the stale
// instance can invalidate Graphics in the live instance (most visibly the tank
// frame and the held-object preview). Keep a single real renderer lifecycle.
createRoot(root).render(<App />);

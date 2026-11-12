import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { installErrorMonitor } from './cloud/monitor';
import { registerServiceWorker } from './pwa/install';
import './cloud/presetSync';

installErrorMonitor();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

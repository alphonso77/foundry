import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ensureAuthenticated } from './auth';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

const reactRoot = ReactDOM.createRoot(root);

// Gate the app behind an access token from the dogfooded IdP. This either
// resolves (token in hand), navigates away to the IdP login (promise never
// resolves), or rejects on a failed callback exchange.
ensureAuthenticated()
  .then(() => {
    reactRoot.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((err: unknown) => {
    reactRoot.render(
      <div className="auth-error">
        <h2>Sign-in failed</h2>
        <p>{err instanceof Error ? err.message : String(err)}</p>
        <button type="button" onClick={() => window.location.assign('/')}>
          Try again
        </button>
      </div>,
    );
  });

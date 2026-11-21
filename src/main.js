import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { initTheme } from './lib/theme.js';

initTheme();

mount(App, { target: document.getElementById('app') });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showUpdateBar();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// A new version was installed in the background. Reloading is safe: the match
// is saved after every ball, and it reopens straight into scoring.
function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('button');
  bar.id = 'update-bar';
  bar.textContent = 'New version ready · tap to update';
  bar.onclick = () => {
    try {
      sessionStorage.setItem('gully-resume', '1');
    } catch {
      /* ignore */
    }
    location.reload();
  };
  document.body.appendChild(bar);
}

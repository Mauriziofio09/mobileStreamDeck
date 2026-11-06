import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

// iOS: Pinch-Zoom-Gesten zusätzlich unterbinden (user-scalable=no wird in Safari teils ignoriert).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

bootstrapApplication(App, appConfig).catch((err: unknown) => console.error(err));

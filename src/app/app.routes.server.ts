import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'p/**',
    renderMode: RenderMode.Server
  },
  {
    path: 'e/**',
    renderMode: RenderMode.Server
  },
  {
    path: 'about/**',
    renderMode: RenderMode.Server
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];

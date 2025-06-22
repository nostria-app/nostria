import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'e/**',
    renderMode: RenderMode.Server
  },
  {
    path: 'p/**',
    renderMode: RenderMode.Server
  },
  {
    path: 'a/**',
    renderMode: RenderMode.Server
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];

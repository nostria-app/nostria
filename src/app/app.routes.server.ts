import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'e/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'p/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'u/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'a/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'stream/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'music/artist/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'music/song/**',
    renderMode: RenderMode.Server,
  },
  {
    path: 'music/playlist/**',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];

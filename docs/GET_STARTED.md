# 🚀 Getting Started with Nostria Development

Welcome to Nostria! This guide will help you set up your development environment and get the project running locally.

## 📋 Prerequisites

Before you begin, ensure you have the following software installed on your system:

### Required Software

1. **Node.js** (v24.0.0 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Choose the LTS (Long Term Support) version
   - Verify installation: `node --version` and `npm --version`

2. **Git**
   - Download from [git-scm.com](https://git-scm.com/) or [GiHub Desktop](https://github.com/apps/desktop)
   - Verify installation: `git --version`

3. **VS Code** (Recommended IDE)
   - Download from [code.visualstudio.com](https://code.visualstudio.com/)
   - Essential extensions (install from VS Code marketplace):
     - Angular Language Service

### Optional but Recommended

4. **Tauri CLI** (for desktop app development)
   - Install with: `npm install -g @tauri-apps/cli`
   - Requires Rust: [rustup.rs](https://rustup.rs/)

5. **Angular CLI**
   - Install globally: `npm install -g @angular/cli@20`
   - Verify installation: `ng version`

## 🛠️ Project Setup

### 1. Clone the Repository

```bash
git clone https://github.com/nostria-app/nostria.git
cd nostria
```

### 2. Install Dependencies

```bash
npm install
```

This will install all the required packages including:
- Angular 20 with signals and effects
- Angular Material
- Nostr-tools
- TypeScript
- And many more dependencies

### 3. Start the Development Server

```bash
npm start
```

Or using the Angular CLI:
```bash
ng serve
```

The application will be available at `http://localhost:4200`

### 4. Verify the Setup

1. Open your browser and navigate to `http://localhost:4200`
2. You should see the Nostria application loading
3. Check the browser console for any errors

## 🏗️ Project Structure

```
nostria/
├── src/
│   ├── app/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/          # Page components (routes)
│   │   ├── services/       # Angular services
│   │   ├── pipes/          # Custom pipes
│   │   └── interfaces.ts   # TypeScript interfaces
│   ├── environments/       # Environment configurations
│   └── styles.scss        # Global styles
├── src-tauri/             # Tauri desktop app files
├── public/                # Static assets
└── package.json          # Dependencies and scripts
```

## 🔧 Development Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start development server |
| `npm run build` | Build for production |
| `npm test` | Run unit tests |
| `npm run watch` | Build and watch for changes |
| `npm run tauri dev` | Start Tauri desktop app (requires Rust) |
| `npm run gen:api` | Generate API client from OpenAPI spec |

## 🎯 Key Technologies

Nostria is built with modern web technologies:

- **Angular 20** - Frontend framework with signals and effects
- **TypeScript** - Type-safe JavaScript
- **Angular Material** - UI component library
- **SCSS** - Styling with Material Design
- **Nostr Protocol** - Decentralized social networking protocol
- **Tauri** - Desktop app framework (Rust + Web)
- **PWA** - Progressive Web App capabilities

## 📱 Development Features

### Modern Angular Patterns
- **Signals** instead of traditional reactive forms
- **Effects** for side effects
- **Standalone components** (no NgModules)
- **New control flow** (`@if`, `@for`, `@let`)
- **Inject function** instead of constructor DI

### Styling Guidelines
- Global styles in `src/styles.scss`
- Component-specific styles in component `.scss` files
- Angular Material design system
- Custom CSS variables for theming

### HTTP Requests
- Use `fetch` API instead of HttpClient
- Async/await pattern preferred
- Type-safe API calls

## 🔍 Debugging

### VS Code Configuration
The project includes VS Code tasks for:
- Starting the development server
- Running tests
- Building the project

Access via `Ctrl+Shift+P` → "Tasks: Run Task"

### Browser DevTools
- **Angular DevTools**: Browser extension for debugging Angular applications
- **Network Tab**: Monitor API calls and WebSocket connections
- **Console**: Check for JavaScript errors and logging

### Common Issues

1. **Port 4200 already in use**
   ```bash
   ng serve --port 4201
   ```

2. **Node modules issues**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **TypeScript errors**
   - Check `tsconfig.json` configuration
   - Ensure all imports are correct
   - Verify Angular version compatibility

## 🌐 Environment Setup

### Development Environment
- Backend API: `http://localhost:3000` (if running backend)
- Frontend: `http://localhost:4200`
- Hot reload enabled

### Environment Files
- `src/environments/environment.ts` - Production
- `src/environments/environment.development.ts` - Development

## 🚀 Next Steps

1. **Explore the codebase**: Start with `src/app/app.ts` and follow the routing
2. **Read the documentation**: Check out `LEARN.md` for learning resources
3. **Make your first change**: Try modifying a component and see hot reload in action
4. **Join the community**: Connect with other Nostria developers

## 📞 Getting Help

- **Issues**: Report bugs on GitHub Issues
- **Discussions**: Join GitHub Discussions
- **Documentation**: Check the `docs/` folder for detailed guides
- **Nostr**: Follow the project on Nostr for updates

## 🎉 Welcome to Nostria Development!

You're now ready to start developing with Nostria. The project follows modern Angular best practices and implements the cutting-edge Nostr protocol for decentralized social networking.

Happy coding! 🚀

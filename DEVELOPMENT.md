# Development Guidelines and Setup

This document outlines the coding standards, tools configuration, and development workflow for the Nostria project.

## Line Endings Policy

**Important**: This project uses **CRLF** line endings exclusively for Windows development consistency.

### Why CRLF?

- All developers work on Windows
- Consistent with Windows development environment
- Eliminates cross-platform line ending issues
- Simplifies Git configuration and file handling

### Configuration Files

The following files enforce CRLF line endings:

- **`.gitattributes`**: Enforces CRLF for all text files in Git
- **`.editorconfig`**: Sets `end_of_line = crlf` for all editors
- **`.prettierrc`**: Sets `"endOfLine": "crlf"` for code formatting
- **`.vscode/settings.json`**: Sets `"files.eol": "\r\n"` for VS Code

### Line Ending Normalization

If you need to normalize existing files to CRLF:

```bash
npm run normalize-line-endings
```

This script will:

1. Convert all LF line endings to CRLF
2. Update Git index with normalized files
3. Show status of changed files

## Code Formatting

### Prettier Configuration

- **Print Width**: 100 characters
- **Quote Style**: Single quotes
- **Semicolons**: Always required
- **Tab Width**: 2 spaces
- **Trailing Commas**: ES5 compatible
- **Line Endings**: CRLF
- **Bracket Spacing**: Enabled
- **Arrow Parens**: Avoid when possible

### Formatting Commands

```bash
# Format all files
npm run format

# Check formatting without modifying files
npm run format:check
```

## Linting

### ESLint Configuration

- Based on Angular ESLint recommended rules
- TypeScript ESLint integration
- Prettier integration for formatting conflicts
- Auto-generated API files are ignored (`src/app/api/**/*`)

### Linting Commands

```bash
# Run linter
npm run lint

# Fix auto-fixable linting issues
npm run lint-fix

# Check linting without fixing
npm run lint:check
```

## Editor Configuration

### VS Code Settings

The project includes VS Code workspace settings that:

- Enable format on save
- Auto-fix ESLint issues on save
- Enforce consistent indentation (2 spaces)
- Set CRLF line endings
- Configure file associations for Angular development

### Required VS Code Extensions

- **Angular Language Service**: Angular IntelliSense
- **ESLint**: Linting integration
- **Prettier**: Code formatting
- **TypeScript Hero**: TypeScript utilities

## Git Configuration

### Recommended Git Settings

```bash
# Ensure CRLF line endings on checkout
git config core.autocrlf true

# Set default branch name
git config init.defaultBranch main
```

### .gitattributes

The `.gitattributes` file ensures:

- All text files use CRLF line endings
- Binary files are handled correctly
- Consistent behavior across different Git configurations

## Development Workflow

### Before Starting Development

1. Ensure your Git configuration is correct:

   ```bash
   git config core.autocrlf true
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Verify formatting and linting work:
   ```bash
   npm run format:check
   npm run lint:check
   ```

### Daily Development

1. **Format on Save**: Enabled automatically in VS Code
2. **Lint on Save**: Auto-fixes ESLint issues
3. **Pre-commit**: Consider using husky for pre-commit hooks

### Before Committing

```bash
# Format all files
npm run format

# Fix linting issues
npm run lint-fix

# Verify everything passes
npm run lint:check
npm run format:check
```

## Project Structure Best Practices

### Angular Guidelines

- Use standalone components (default)
- Prefer signals for state management
- Use `input()` and `output()` functions
- Set `OnPush` change detection strategy
- Use native control flow (`@if`, `@for`, `@switch`)

### TypeScript Guidelines

- Enable strict type checking
- Prefer type inference when obvious
- Avoid `any` type; use `unknown` when uncertain
- Use `inject()` function instead of constructor injection

### File Organization

```
src/
├── app/
│   ├── components/     # Reusable UI components
│   ├── pages/         # Route components
│   ├── services/      # Business logic and data services
│   ├── pipes/         # Custom pipes
│   └── interfaces/    # TypeScript interfaces and types
├── styles/           # Global styles
└── environments/     # Environment configurations
```

## Troubleshooting

### Line Ending Issues

If you encounter line ending problems:

1. Run the normalization script:

   ```bash
   npm run normalize-line-endings
   ```

2. Refresh Git index:

   ```bash
   git add --renormalize .
   ```

3. Commit the changes:
   ```bash
   git commit -m "Normalize line endings to CRLF"
   ```

### Formatting Conflicts

If Prettier and ESLint conflict:

1. Check both configurations are aligned
2. Run format before linting:
   ```bash
   npm run format
   npm run lint-fix
   ```

### Performance Issues

If development server is slow:

1. Check for circular dependencies
2. Use `ng build --watch` for faster rebuilds
3. Consider using `ng serve --hmr` for hot module replacement

## Resources

- [Angular Style Guide](https://angular.dev/style-guide)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Prettier Configuration](https://prettier.io/docs/en/configuration.html)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Nostr NIPs](https://github.com/nostr-protocol/nips) - Protocol specifications

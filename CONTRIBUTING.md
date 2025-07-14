# Contributing to Timeline Theories

Thank you for your interest in contributing to Timeline Theories! We welcome contributions from everyone, whether you're fixing bugs, adding features, improving documentation, or suggesting new ideas.

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have:
- Node.js 18 or higher
- npm or yarn package manager
- Git for version control
- A SenseNet ECM repository for testing
- Basic knowledge of React, TypeScript, and modern web development

### Development Setup

1. **Fork and Clone**
   ```bash
   # Fork the repository on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/timeline-theories.git
   cd timeline-theories
   ```

2. **Install Dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install client dependencies
   cd client
   npm install
   cd ..
   ```

3. **Environment Configuration**
   ```bash
   # Copy environment template
   cp client/.env.example client/.env
   
   # Edit client/.env with your configuration
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## 📝 Development Workflow

### Branch Naming Convention

Use descriptive branch names following this pattern:
- `feature/feature-name` - New features
- `fix/bug-description` - Bug fixes
- `docs/what-changed` - Documentation updates
- `refactor/component-name` - Code refactoring
- `test/test-description` - Test additions/improvements

### Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples:**
```
feat(timeline): add drag-and-drop reordering
fix(trakt): resolve duplicate timeline creation
docs(readme): update installation instructions
refactor(services): extract timeline service methods
```

### Pull Request Process

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Write clean, maintainable code
   - Follow existing code style and patterns
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   # Run the development server
   npm run dev
   
   # Test your changes thoroughly
   # Ensure no existing functionality is broken
   ```

4. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat(component): add new feature"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   
   Then create a Pull Request on GitHub with:
   - Clear title and description
   - Link to any related issues
   - Screenshots/GIFs for UI changes
   - Testing instructions

## 🏗️ Project Structure

```
timeline-theories/
├── client/                     # React frontend
│   ├── components/            # Reusable UI components
│   │   ├── AuthenticatedContent.tsx
│   │   ├── TraktImportDialog.tsx
│   │   └── ...
│   ├── pages/                 # Route-based pages
│   │   ├── TimelineCreatePage.tsx
│   │   ├── MediaLibraryPage.tsx
│   │   └── ...
│   ├── services/              # API and business logic
│   │   ├── timelineService.ts
│   │   ├── traktService.ts
│   │   └── ...
│   ├── netlify/functions/     # Serverless functions
│   └── styles/                # CSS styles
├── docs/                      # Documentation
├── deployment/                # Deployment configs
└── README.md
```

## 🎯 Contribution Areas

### High Priority Areas
- **Trakt.tv Integration**: Enhance existing features, add new endpoints
- **UI/UX Improvements**: Better responsive design, accessibility
- **Performance**: Optimization of large timeline handling
- **Testing**: Unit tests, integration tests, E2E tests
- **Documentation**: User guides, API documentation

### Feature Ideas
- Additional external service integrations (IMDb, TMDb, etc.)
- Timeline sharing and collaboration features
- Advanced search and filtering
- Timeline analytics and statistics
- Mobile app or PWA features

## 🧪 Testing Guidelines

### Manual Testing
1. Test core user flows:
   - Create new timeline
   - Add media items
   - Import from Trakt
   - Reorder timeline entries
   - Share timeline

2. Test edge cases:
   - Empty states
   - Large datasets
   - Network failures
   - Invalid inputs

### Automated Testing
```bash
# Run tests (when available)
npm run test

# Run linting
npm run lint

# Type checking
npm run type-check
```

## 📋 Code Style Guidelines

### TypeScript/JavaScript
- Use TypeScript strict mode
- Prefer functional components and hooks
- Use meaningful variable and function names
- Add JSDoc comments for complex functions
- Handle errors gracefully with proper error boundaries

### React Components
```typescript
// Good component structure
interface Props {
  timeline: Timeline;
  onUpdate: (timeline: Timeline) => void;
}

export const TimelineCard: React.FC<Props> = ({ timeline, onUpdate }) => {
  // Component logic here
  return (
    <div className="timeline-card">
      {/* JSX here */}
    </div>
  );
};
```

### CSS/Styling
- Use consistent naming conventions
- Prefer CSS modules or styled-components
- Follow mobile-first responsive design
- Ensure accessibility (WCAG guidelines)

## 🐛 Reporting Issues

### Bug Reports
When reporting bugs, please include:
- Steps to reproduce
- Expected vs actual behavior
- Browser and OS information
- Screenshots or videos if applicable
- Console errors or logs

### Feature Requests
For feature requests, please provide:
- Clear description of the feature
- Use case and benefits
- Mockups or examples if applicable
- Implementation suggestions (optional)

## 📚 Resources

### Documentation
- [SenseNet ECM Documentation](https://docs.sensenet.com/)
- [Trakt.tv API Documentation](https://trakt.docs.apiary.io/)
- [React Documentation](https://reactjs.org/docs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Project Documentation
- [docs/kickoff.md](docs/kickoff.md) - Project overview
- [docs/implementation-tasks.md](docs/implementation-tasks.md) - Development progress
- [docs/content-types-specification.md](docs/content-types-specification.md) - Data models

## 💬 Getting Help

- **GitHub Issues**: For bug reports and feature requests
- **GitHub Discussions**: For questions and general discussion
- **Code Review**: All PRs receive thorough review and feedback

## 🙏 Recognition

Contributors will be recognized in:
- Repository contributors list
- Release notes (for significant contributions)
- Project documentation credits

Thank you for helping make Timeline Theories better! 🎉

# Contributing to Timeline Theories

**Important Note**: Timeline Theories is a personal project maintained by VargaJoe for their own timeline research site. This is primarily a personal tool, and feature additions or timeline curation are based on the maintainer's direction and personal interests.

While feedback and suggestions are welcome, please understand that:
- Feature requests may not be accepted unless they align with the maintainer's personal needs
- Pull requests are evaluated based on personal project requirements
- This is not a community-driven project seeking active external contributors

If you're interested in similar functionality for your own use, please consider forking the project.

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

## 📝 Suggesting Changes

Since this is a personal project, the development workflow is simplified:

### Reporting Issues
When reporting bugs, please include:
- Steps to reproduce
- Expected vs actual behavior
- Browser and OS information
- Screenshots or videos if applicable
- Console errors or logs

### Suggesting Features
For feature requests, please provide:
- Clear description of the feature
- Your use case and why it would benefit the project
- Understanding that acceptance depends on maintainer's personal needs

### Code Contributions
If you'd like to contribute code:
1. Open an issue first to discuss the change
2. Fork the repository if the maintainer is interested
3. Make focused, minimal changes
4. Ensure changes align with the personal project's goals

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

## 🎯 Areas of Interest

If you're interested in the project, these are areas where the maintainer has ongoing interest:
- **Trakt.tv Integration**: Enhance existing features, add new endpoints
- **UI/UX Improvements**: Better responsive design, accessibility
- **Performance**: Optimization of large timeline handling
- **Documentation**: User guides, API documentation

## 📋 Technical Information

The project maintains these technical standards:
- TypeScript strict mode
- React functional components and hooks
- Meaningful variable and function names
- Proper error handling

For technical setup information, see the main README.md file.

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
- **Project Documentation**: See the docs/ folder for technical details

This is a personal project, so response times may vary based on the maintainer's availability and interest in the particular issue.

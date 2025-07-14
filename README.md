# 📚 Timeline Theories

> **Create, organize, and share timeline lists for stories or universes of different media in chronological order.**

Timeline Theories is a modern web application designed for fans and creators who want to organize complex multi-media storylines into coherent, chronological timelines. Perfect for franchises like Star Wars, Marvel, Doctor Who, and more.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](#)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](#)

---

## ✨ Features

### 🎬 **Multi-Media Timeline Creation**
- Support for films, TV episodes, books, comics, games, and more
- Create timelines in chronological or release order
- Reuse media items across multiple timelines
- Import entire lists from Trakt.tv with review workflow

### 🔗 **External Integrations**
- **Trakt.tv Integration**: Import lists and sync with your Trakt account
- **Rich Media Links**: Connect to IMDb, Goodreads, YouTube, Amazon, and more
- **Cover Images**: Automatic cover art from external sources

### 🎯 **Powerful Organization**
- Drag-and-drop timeline entry reordering
- Smart media item deduplication
- Timeline entry grouping and arcs
- Advanced search and filtering capabilities

### 👥 **Sharing & Collaboration**
- Public timeline sharing
- Timeline cloning and forking
- User authentication with OIDC
- Community-driven content

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- SenseNet ECM repository (for backend)
- Trakt.tv API key (optional, for Trakt integration)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/VargaJoe/timeline-theories.git
cd timeline-theories
```

2. **Install dependencies**
```bash
# Root dependencies
npm install

# Client dependencies
cd client
npm install
```

3. **Environment Setup**
```bash
# Copy environment template
cp client/.env.example client/.env
```

4. **Configure Environment Variables**
Edit `client/.env`:
```env
# SenseNet Repository Configuration
VITE_SENSENET_REPO_URL=https://your-sensenet-repo-url
VITE_PROJECT_ROOT_PATH=/Root/Content

# OIDC Authentication
VITE_OIDC_CLIENT_ID=your-client-id
VITE_OIDC_AUTHORITY=https://your-identity-server-url

# Trakt.tv Integration (Optional)
VITE_TRAKT_API_KEY=your-trakt-api-key
```

5. **Start Development Server**
```bash
npm run dev
```

Visit `http://localhost:5173` to see the application.

---

## 🏗️ Architecture

### Frontend Stack
- **React 17** - UI framework
- **TypeScript** - Type safety and developer experience  
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **React Beautiful DnD** - Drag and drop functionality

### Backend & Services
- **SenseNet ECM** - Content management and storage
- **OIDC Authentication** - Secure user authentication
- **Netlify Functions** - Serverless API endpoints
- **Trakt.tv API** - Media data and list imports

### Project Structure
```
timeline-theories/
├── client/                 # React frontend application
│   ├── components/         # Reusable UI components
│   ├── pages/             # Route-based page components
│   ├── services/          # API and data services
│   ├── netlify/functions/ # Serverless functions
│   └── styles/            # CSS styles
├── docs/                  # Project documentation
├── deployment/            # Deployment configurations
└── package.json          # Root package configuration
```

---

## 🔧 Development

### Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build for production

# Client-specific
cd client
npm run dev          # Start client dev server
npm run build        # Build client
npm run preview      # Preview production build
```

### Content Types

The application uses SenseNet ECM with these content types:
- **Timeline** - Main timeline containers
- **MediaItem** - Individual media entries (films, books, etc.)
- **TimelineEntry** - Links between timelines and media items

### API Integration

#### Trakt.tv Integration
```typescript
// Example: Fetch Trakt list
const items = await fetchTraktList(username, listSlug);
// Returns: TraktListItem[] with title, year, type, ids
```

#### SenseNet Integration
```typescript
// Example: Create timeline
const timeline = await createTimeline({
  name: 'my-timeline',
  displayName: 'My Timeline',
  description: 'A great timeline'
});
```

---

## 📱 Usage Examples

### Creating a Timeline
1. Navigate to "Create Timeline"
2. Fill in timeline details (title, description, sort order)
3. Optionally import from Trakt.tv list
4. Review and edit imported items
5. Create timeline with selected media

### Managing Media Library
1. Add media items manually or via Trakt import
2. Set cover images and external links
3. Reuse items across multiple timelines
4. Organize with tags and categories

### Timeline Organization
1. Drag and drop to reorder entries
2. Group related entries into arcs
3. Set chronological dates vs release dates
4. Share publicly or keep private

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Standards
- TypeScript strict mode enabled
- ESLint configuration enforced
- Consistent code formatting with Prettier
- Component-based architecture
- Comprehensive error handling

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Trakt.tv](https://trakt.tv) for their excellent API
- [SenseNet](https://sensenet.com) for content management platform
- [React Beautiful DnD](https://github.com/atlassian/react-beautiful-dnd) for drag and drop
- The open source community for inspiration and tools

---

## 🔗 Links

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/VargaJoe/timeline-theories/issues)
- **Discussions**: [GitHub Discussions](https://github.com/VargaJoe/timeline-theories/discussions)

---

*Built with ❤️ for media enthusiasts and timeline organizers everywhere.*

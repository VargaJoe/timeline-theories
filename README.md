# 📚 Timeline Theories

> **Create, organize, and share timeline lists for stories or universes of different media in chronological order.**

Timeline Theories is a personal web application I created to organize complex multi-media storylines into coherent, chronological timelines. Perfect for franchises like Star Wars, Marvel, Doctor Who, and more. The timeline lists reflect my research and personal opinions about chronological order.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)](#)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](#)

---

## ✨ Features

### 🎬 **Multi-Media Timeline Creation**
- Support for films, TV episodes, books, comics, games, and more
- Store chronology/release metadata and manage editorial entry order
- Reuse media items across multiple timelines
- Import existing Trakt.tv lists (already used for the important source lists)

### 🔗 **External Integrations**
- **Trakt.tv Integration**: Import public lists through a server provider proxy
- **Rich Media Links**: Connect to IMDb, Goodreads, YouTube, Amazon, and more
- **Cover Images**: Automatic cover art from external sources

### 🎯 **Powerful Organization**
- Drag-and-drop timeline entry reordering
- Preserved repeated media occurrences and editorial order
- Timeline entry grouping and arcs
- ABC browsing, incremental loading and media-library text search

### 👥 **Sharing & Personal Collections**
- Public timeline sharing
- User authentication with OIDC
- Private timelines protected by repository permissions

Current feature coverage and limitations are recorded in the [2026-10-14 feature audit](docs/feature-status-audit-2026-10-14.md). The [native content-management API](docs/m1-native-api.md) runs inside this Netlify app. UI and native clients share application plans and permission checks; SenseNet remains the independent content repository. Private grants, plans and receipts use app Blobs storage. See [M1 parity and verification](docs/m1-verification.md) for test evidence and limits. Cloning, advanced timeline search and account synchronization remain backlog.

---

## 🚀 Quick Start

Use Node.js 22.21+, PowerShell 7, Docker Desktop and the .NET 8 SDK (a newer compatible SDK also works). The M0 default is an isolated local repository with trusted HTTPS.

```powershell
npm ci
npm ci --prefix client
./deployment/scripts/m0-bootstrap.ps1 -TrustCertificate
node scripts/m1-local-inventory-setup.cjs
npm run dev:m0
```

Open https://localhost:8080 for the isolated M0 app; its API is https://localhost:8080/api/v1. One Netlify Dev command serves the UI and Functions. Ordinary `npm run dev` / `npm run build` take their repository/auth targets from standard `client/.env` and hosting variables. Existing `.env` files are preserved; `dev:m0` explicitly selects M0. Keep credentials in private app configuration.

See [local runtime, full snapshot and restore](docs/m0-local-data.md), [profiles, permissions and manual tests](docs/m0-client-safety.md), and the [M0 verification handoff](docs/m0-verification-2026-10-13.md) for setup and validation. The application does not provision content on startup.

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
npm run build        # Build the local profile (deployment is separate)

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

## 🤝 Feedback & Suggestions

This project is maintained by VargaJoe as a personal tool for organizing timeline theories and research. While this is primarily a personal project, feedback and suggestions are welcome through GitHub issues.

**Note**: This project reflects my personal research and opinions about media chronologies. Feature requests and pull requests may not be accepted unless they align with my specific needs and interests for this personal timeline site.

### If You Want to Contribute
1. Check existing issues for known bugs or requested features
2. Open an issue to discuss your idea before submitting a PR
3. Keep in mind this is optimized for my personal use case
4. Fork the project if you need different functionality

---

## 🎯 Project Philosophy

Timeline Theories is a **personal project** created and maintained by VargaJoe. It serves as my digital tool for researching and organizing complex media franchises into coherent chronological orders.

**Key Points:**
- **Personal Research**: All timeline orderings reflect my personal research and opinions
- **Single Maintainer**: This project is maintained by one person (VargaJoe) for their own use
- **Opinion-Based**: Timeline theories presented here are subjective interpretations, not community consensus
- **Personal Tool**: Primary focus is on my specific needs for timeline organization and research

While the code is open source and others may find it useful, please understand that this is fundamentally a personal project built to support my timeline research interests.

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

*Built with ❤️ by VargaJoe for personal timeline research and organization.*

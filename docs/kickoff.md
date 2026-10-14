# 📚 Timeline Theories – Personal Multi-Media Timeline Tool

> **Current project status — 2026-10-14:** This is the original product vision. Implemented/partial/missing capabilities are classified in the [feature audit](feature-status-audit-2026-10-14.md). Trakt import is an existing used feature; the next milestone is the [native agent content-management API](m1-agent-api-session-prompt-2026-10-14.md), including writes. The architecture below has been updated to the actual SenseNet application.

A personal web application for creating and managing timeline-based lists of media entries (films, episodes, books, comics, etc.) based on either in-universe chronology or real-world release order. Designed for organizing complex timelines like Doctor Who, Star Wars, Marvel, etc., based on personal research and opinions.

---

## 🧩 Key Features

- Mixed media entries (films, TV episodes, books, comics, etc.)
- External references: IMDb, Trakt, Goodreads, YouTube, Amazon, etc.
- Reusable media entries across multiple lists
- Same media item can appear multiple times in a single list
- Sorting by user-defined chronology or calendar time
- Tags, search, and filtering (e.g., by character or storyline)
- Free hosting and storage priority

---

## 💻 Tech Stack

### Frontend
- **Framework**: React + TypeScript
- **Styling**: Existing component styles and CSS
- **State Management**: React state/context and existing service layer
- **Routing**: React Router
- **Build/Deploy**: Vite + Netlify (free tier)

### Backend
- **Content repository**: SenseNet, with Timeline/MediaItem/BookMediaItem/TimelineEntry custom types
- **Auth**: OIDC and alternative SNAuth mode; concrete repository permissions
- **Current transport**: Browser services to SenseNet OData, plus Netlify Trakt provider function
- **Next API**: Shared application-domain operations exposed for native external clients; hosting/auth design settled during M1

### Other Tools
- **Markdown support**: For user-added descriptions or notes
- **Images**: SenseNet binary covers and supported external image URLs
- **Link validation**: Via OpenGraph or metadata scraping

---

## 🧪 Personal Use Cases

### Epic: Timeline Management

#### US001 – Create New Timeline
> As the maintainer, I want to create a new timeline with a title, description, and sorting method (chronological or release order), so I can organize media items according to my research.

#### US002 – Add Media Entry to Global Library
> As the maintainer, I want to add a media item with metadata (title, type, cover image, external links, description) to a global media library, so it can be reused across multiple timelines.

#### US003 – Add Existing Media Entry to Timeline
> As the maintainer, I want to include an existing media item in my timeline at any point I choose, so I don't need to duplicate data.

#### US004 – Reuse Media Item Multiple Times
> As the maintainer, I want to use the same media item multiple times in a single timeline (e.g., if it appears in two story arcs), optionally with notes.

#### US005 – Link Media Items to External Sources
> As the maintainer, I want to add references (IMDb, Trakt, Goodreads, Amazon, YouTube, etc.) to a media item, based on its type.

#### US006 – Organize Timeline Entries
> As the maintainer, I want to drag-and-drop or number items in my timeline to define their order, and optionally group them by arc or date.

#### US007 – View and Share Timeline
> As the maintainer, I want to view my timeline in a clean interface and share it via a public link with read-only access for others interested in my research.

---

### Epic: Personal Features

#### US008 – Authentication and Access
> As the maintainer, I want to have secure access to my timeline management system using authentication.

#### US009 – Tag Media Items
> As the maintainer, I want to add tags (e.g., character names, arcs, themes) to media items to improve my research organization and filtering.

#### US010 – Search and Filter Timelines
> As the maintainer, I want to search timelines by keyword, tags, or media type, so I can find relevant content faster during research.

#### US011 – Clone or Fork Timelines
> As the maintainer, I want to duplicate my own timelines to build variant versions for different research approaches.

---

## 💡 Suggested Table Structure (Simplified)

### `media_item`
- id
- title
- media_type (film, episode, book, etc.)
- description
- cover_url
- external_links (JSON array)
- tags

### `timeline`
- id
- title
- description
- owner_user_id
- is_public
- sort_order (chronological | release)

### `timeline_entry`
- id
- timeline_id
- media_item_id
- position (int or timestamp)
- note
- repeat_label (e.g., "Alt. Timeline")

---

## 🆓 Free Hosting Suggestions

- **Frontend**: Netlify / Vercel (free static hosting)
- **Backend/DB**: Existing configured SenseNet repository; isolated local M0 runtime for development writes
- **Optional**: GitHub Pages (only static), Cloudflare Pages

---

## 🚀 Future Ideas

- Collaborative timelines (multi-user edit)
- Versioning and history tracking
- Embedded timelines on other sites
- Timeline export to PDF/JSON
- AI-based suggestions for timeline consistency

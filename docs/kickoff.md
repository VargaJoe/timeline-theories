# 📚 TimelineVerse – User-Created Multi-Media Timelines

A web application that allows users to create and manage timeline-based lists of media entries (films, episodes, books, comics, etc.) based on either in-universe chronology or real-world release order. Designed especially for fandoms with complex timelines like Doctor Who, Star Wars, Marvel, etc.

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
- **Styling**: TailwindCSS or shadcn/ui
- **State Management**: Zustand or Context API
- **Routing**: React Router
- **Build/Deploy**: Vite + Netlify (free tier)

### Backend
- **Database**: Supabase (PostgreSQL with free tier, supports auth and media storage)
- **Auth**: Supabase Auth or Clerk.dev (email/password, social login)
- **API**: Supabase Edge Functions or Firebase Functions (free)
- **ORM/Query**: Prisma (optional if using Supabase directly)

### Other Tools
- **Markdown support**: For user-added descriptions or notes
- **Image hosting**: Supabase Storage or Cloudinary (free plan)
- **Link validation**: Via OpenGraph or metadata scraping

---

## 🧪 User Stories

### Epic: Timeline Management

#### US001 – Create New Timeline
> As a user, I want to create a new timeline with a title, description, and sorting method (chronological or release order), so I can organize media items accordingly.

#### US002 – Add Media Entry to Global Library
> As a user, I want to add a media item with metadata (title, type, cover image, external links, description) to a global media library, so it can be reused across multiple timelines.

#### US003 – Add Existing Media Entry to Timeline
> As a user, I want to include an existing media item in my timeline at any point I choose, so I don't need to duplicate data.

#### US004 – Reuse Media Item Multiple Times
> As a user, I want to use the same media item multiple times in a single timeline (e.g., if it appears in two story arcs), optionally with notes.

#### US005 – Link Media Items to External Sources
> As a user, I want to add references (IMDb, Trakt, Goodreads, Amazon, YouTube, etc.) to a media item, based on its type.

#### US006 – Organize Timeline Entries
> As a user, I want to drag-and-drop or number items in my timeline to define their order, and optionally group them by arc or date.

#### US007 – View and Share Timeline
> As a user, I want to view my timeline in a clean interface and share it via a public link with read-only access.

---

### Epic: User Features

#### US008 – Register and Log In
> As a user, I want to register and log in using email or a third-party service, so my timelines are saved.

#### US009 – Tag Media Items
> As a user, I want to add tags (e.g., character names, arcs, themes) to media items to improve filtering and search.

#### US010 – Search and Filter Timelines
> As a user, I want to search timelines by keyword, tags, or media type, so I can find relevant content faster.

#### US011 – Clone or Fork Public Timelines
> As a user, I want to duplicate another user’s public timeline to build my own variant version.

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
- **Backend/DB**: Supabase (auth + DB + storage)
- **Optional**: GitHub Pages (only static), Cloudflare Pages

---

## 🚀 Future Ideas

- Collaborative timelines (multi-user edit)
- Versioning and history tracking
- Embedded timelines on other sites
- Timeline export to PDF/JSON
- AI-based suggestions for timeline consistency

# Export/Import Timeline Data - Detailed Usage Guide

## Overview

The export/import functionality allows bulk management of timelines and their entries using external tools (e.g., Notepad++, Excel). The system saves and loads data in ZIP format, which includes the timeline_data.tsv file and the covers/ folder with images.

## Export Functionality

### How to export a timeline?

1. **Navigation**: Go to the desired timeline page (e.g., `/timeline/my-timeline`)
2. **Export button**: Click the "Export Timeline" button among the timeline action buttons
3. **Wait**: The system downloads images and creates the ZIP file
4. **Download**: The browser automatically downloads the `timeline-[name]-[date].zip` file

### What does the exported ZIP file contain?

```
timeline-my-timeline-2025-12-21.zip
├── timeline_data.tsv    # Timeline data separated by tabs
└── covers/              # Images folder
    ├── cover_0.jpg
    ├── cover_1.jpg
    └── ...
```

### TSV Format Description

| Column Name | Required | Description | Example |
|-------------|----------|-------------|---------|
| timeline_name | No | Timeline name for reference | "Star Wars Chronology" |
| entry_name | No | Entry name unique within timeline | "episode-4" |
| Title | Yes | Entry title | "Star Wars: Episode IV - A New Hope" |
| Description | No | Media item description | "The original Star Wars film..." |
| MediaType | Yes | Media type | "movie", "tvepisode", "book" |
| media_id | No | Media item identifier (for updates) | "12345" |
| cover_image | No | Image filename in ZIP | "cover_0.jpg" |
| ChronologicalDate | No | Chronological date | "1977-05-25" |
| Position | No | Position in timeline | "1" |
| Notes | No | Timeline-specific notes | "First appearance of Luke Skywalker" |
| EntryLabel | No | Entry type | "mainstory", "flashback" |
| Importance | No | Importance | "essential", "important" |
| ChronologicalDescription | No | Flexible chronology description | "During the Clone Wars" |
| Author | No | Author (for books) | "George Lucas" |
| Publisher | No | Publisher (for books) | "Del Rey" |
| ISBN | No | ISBN number | "978-0345325815" |
| PublicationYear | No | Publication year | "1977" |
| Genre | No | Genres (comma-separated) | "SciFi, Action" |
| Tags | No | Tags (comma-separated) | "star wars, space opera" |

## Import Functionality

### How to import timeline data?

1. **Navigation**: Go to an empty timeline page, or create a new one
2. **Import button**: Click the "Import Timeline" button
3. **File selection**: Select the ZIP file from the file browser
4. **Processing**: The system automatically:
   - Extracts the ZIP file
   - Reads the timeline_data.tsv
   - Uploads the images
   - Creates/updates the entries

### Import Behavior

#### Timeline Entries handling:
- **If doesn't exist**: Creates new timeline entry
- **If exists**: Updates existing entry data
- **Identification**: Matching based on `entry_name` field

#### Media Items handling:
- **If doesn't exist**: Creates new media item in Media Library
- **If exists**: Updates existing media item data
- **Identification**: Based on `media_id` field (SenseNet ID)

#### Images handling:
- **From ZIP**: Automatically uploads from `covers/` folder
- **URLs**: Downloads and uploads from specified URLs
- **Errors**: Shows warning for missing images but continues import

## Common Use Cases

### 1. Timeline Backup and Restore
```
Task: Complete backup and restore of a timeline
Steps:
1. Export the source timeline
2. Create a new empty timeline
3. Import the exported ZIP into the new timeline
```

### 2. Timeline Editing in External Tools
```
Task: Bulk edits in Notepad++
Steps:
1. Export the timeline
2. Open timeline_data.tsv in Notepad++
3. Edit the fields (watch for tabs!)
4. Save the TSV
5. Repackage into ZIP with covers/ folder
6. Import back into the same timeline
```

### 3. Bulk Addition of Timeline Entries
```
Task: Add many new entries at once
Steps:
1. Create a new empty timeline
2. Create timeline_data.tsv file with entries
3. Optionally add images to covers/ folder
4. Package into ZIP
5. Import into the new timeline
```

### 4. Bulk Update of Media Library Items
```
Task: Update many media item details
Steps:
1. Export the timeline (includes media item data)
2. Edit Description, Author, Publisher etc. fields
3. Import back - this updates media items too
```

### 5. Timeline Duplication with New Name
```
Task: Copy timeline with different name
Steps:
1. Export the original timeline
2. Open TSV and change timeline_name field
3. Create new empty timeline
4. Import the modified ZIP
```

## Error Handling and Troubleshooting

### Common Errors

#### "timeline_data.tsv not found in ZIP file"
- **Cause**: ZIP file doesn't contain the required TSV file
- **Solution**: Ensure ZIP contains `timeline_data.tsv` file

#### "Insufficient columns (X/19)"
- **Cause**: Missing columns in TSV file
- **Solution**: Check that all required columns are present

#### "Failed to upload cover: ..."
- **Cause**: Image upload error (non-critical)
- **Solution**: Import continues, works without images

#### "Entry already exists"
- **Cause**: Duplicate import or same entry_name
- **Solution**: Use unique entry_name values

### Validation Rules

- **Required fields**: Title, MediaType
- **Unique identifiers**: entry_name within a timeline
- **Data formats**:
  - Dates: YYYY-MM-DD or free text
  - Positions: integers
  - Lists: comma-separated

## Technical Details

### File Size Limitations
- ZIP file: Browser dependent (usually 2GB)
- Individual images: 10MB/file maximum
- TSV rows: Unlimited number

### Security
- Admin-only access
- Files temporarily stored during processing
- Failed imports automatically cleaned up

### Performance
- For large timelines, use smaller batches
- Image uploads happen in parallel
- Progress feedback at every step

## Example Workflow

### Complete Timeline Backup and Restore
1. **Export**: Download `timeline-starwars-2025-12-21.zip`
2. **Edit**: Open TSV in Excel, modify data
3. **New Timeline**: Create "Star Wars - Updated" timeline
4. **Import**: Upload ZIP, automatic processing
5. **Verify**: New timeline appears with updated data

This functionality gives administrators full control over timeline data, enabling efficient offline editing and bulk operations.
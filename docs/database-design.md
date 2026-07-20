# Database Design: Blog / CMS

Relational (SQL) schema for a blog / content-management system. Covers
authoring, categorization, tagging, threaded comments, and media uploads.

## Entities

| Entity | Purpose |
|---|---|
| `users` | Authors, editors, admins, and registered commenters |
| `categories` | Hierarchical grouping for posts (supports subcategories) |
| `tags` | Free-form labels attached to posts (many-to-many) |
| `posts` | Blog articles/pages |
| `post_tags` | Junction table resolving the posts↔tags many-to-many relationship |
| `comments` | Threaded comments on posts, from registered users or guests |
| `media` | Uploaded files (images, etc.) referenced by posts and users |

## ER Diagram

```mermaid
erDiagram
    USERS ||--o{ POSTS : authors
    USERS ||--o{ COMMENTS : writes
    USERS ||--o{ MEDIA : uploads
    CATEGORIES ||--o{ POSTS : categorizes
    CATEGORIES ||--o{ CATEGORIES : "parent of"
    POSTS ||--o{ COMMENTS : receives
    POSTS ||--o{ POST_TAGS : has
    TAGS ||--o{ POST_TAGS : "tagged on"
    COMMENTS ||--o{ COMMENTS : "replies to"
    MEDIA ||--o{ POSTS : "featured image"

    USERS {
        int id PK
        string username UK
        string email UK
        string password_hash
        string display_name
        string bio
        int avatar_media_id FK
        enum role
        timestamp created_at
        timestamp updated_at
    }

    CATEGORIES {
        int id PK
        string name
        string slug UK
        string description
        int parent_id FK
        timestamp created_at
    }

    TAGS {
        int id PK
        string name
        string slug UK
    }

    POSTS {
        int id PK
        int author_id FK
        int category_id FK
        int featured_media_id FK
        string title
        string slug UK
        string excerpt
        text content
        enum status
        timestamp published_at
        timestamp created_at
        timestamp updated_at
    }

    POST_TAGS {
        int post_id FK
        int tag_id FK
    }

    COMMENTS {
        int id PK
        int post_id FK
        int author_id FK
        int parent_comment_id FK
        string guest_name
        string guest_email
        text content
        enum status
        timestamp created_at
    }

    MEDIA {
        int id PK
        int uploader_id FK
        string file_url
        string file_type
        string alt_text
        timestamp created_at
    }
```

## Table Definitions

### `users`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, auto-increment |
| username | VARCHAR(50) | UNIQUE, NOT NULL |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| display_name | VARCHAR(100) | NOT NULL |
| bio | TEXT | NULL |
| avatar_media_id | INTEGER | FK → media.id, NULL |
| role | ENUM('admin','editor','author','subscriber') | NOT NULL, DEFAULT 'subscriber' |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMP | NOT NULL, DEFAULT now() |

### `categories`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, auto-increment |
| name | VARCHAR(100) | NOT NULL |
| slug | VARCHAR(120) | UNIQUE, NOT NULL |
| description | TEXT | NULL |
| parent_id | INTEGER | FK → categories.id, NULL (self-reference for subcategories) |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |

### `tags`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, auto-increment |
| name | VARCHAR(50) | NOT NULL |
| slug | VARCHAR(60) | UNIQUE, NOT NULL |

### `posts`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, auto-increment |
| author_id | INTEGER | FK → users.id, NOT NULL |
| category_id | INTEGER | FK → categories.id, NULL |
| featured_media_id | INTEGER | FK → media.id, NULL |
| title | VARCHAR(255) | NOT NULL |
| slug | VARCHAR(280) | UNIQUE, NOT NULL |
| excerpt | VARCHAR(500) | NULL |
| content | TEXT | NOT NULL |
| status | ENUM('draft','published','archived') | NOT NULL, DEFAULT 'draft' |
| published_at | TIMESTAMP | NULL |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |
| updated_at | TIMESTAMP | NOT NULL, DEFAULT now() |

Index: `(status, published_at)` to speed up "published posts by date" queries.

### `post_tags`
| Column | Type | Constraints |
|---|---|---|
| post_id | INTEGER | PK (composite), FK → posts.id |
| tag_id | INTEGER | PK (composite), FK → tags.id |

### `comments`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, auto-increment |
| post_id | INTEGER | FK → posts.id, NOT NULL |
| author_id | INTEGER | FK → users.id, NULL (NULL = guest comment) |
| parent_comment_id | INTEGER | FK → comments.id, NULL (self-reference for threaded replies) |
| guest_name | VARCHAR(100) | NULL (required when author_id is NULL) |
| guest_email | VARCHAR(255) | NULL (required when author_id is NULL) |
| content | TEXT | NOT NULL |
| status | ENUM('pending','approved','spam') | NOT NULL, DEFAULT 'pending' |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |

### `media`
| Column | Type | Constraints |
|---|---|---|
| id | INTEGER | PK, auto-increment |
| uploader_id | INTEGER | FK → users.id, NOT NULL |
| file_url | VARCHAR(500) | NOT NULL |
| file_type | VARCHAR(50) | NOT NULL |
| alt_text | VARCHAR(255) | NULL |
| created_at | TIMESTAMP | NOT NULL, DEFAULT now() |

## Design Notes

- **Normalization**: schema is in 3NF — tags and categories are extracted
  into their own tables rather than stored as strings on `posts`, avoiding
  update anomalies and duplicated text.
- **Many-to-many via junction table**: `post_tags` resolves posts↔tags
  without denormalizing either side.
- **Self-referencing FKs**: `categories.parent_id` supports nested
  categories (e.g. "Tech" → "Databases"); `comments.parent_comment_id`
  supports threaded replies.
- **Guest comments**: `comments.author_id` is nullable so unauthenticated
  visitors can comment via `guest_name`/`guest_email`, while registered
  users are linked by FK.
- **Slugs over IDs in URLs**: `slug` columns are unique and indexed to
  support human-readable, SEO-friendly URLs (`/posts/my-first-post`).
- **Soft state via `status` enums** rather than deleting rows, so drafts,
  archived posts, and moderated comments remain recoverable.

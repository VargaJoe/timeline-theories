# Deployment Guide

This guide covers deploying Timeline Theories to various platforms.

## Prerequisites

Before deploying, ensure you have:
- Node.js 18+ installed
- Access to a SenseNet ECM repository
- OIDC authentication provider configured
- Trakt.tv API key (optional)
- Git repository with your code

## Environment Configuration

### Required Environment Variables

Create production environment files with these variables:

```env
# SenseNet Repository Configuration
VITE_SENSENET_REPO_URL=https://your-production-sensenet-repo.com
VITE_PROJECT_ROOT_PATH=/Root/Content

# OIDC Authentication
VITE_OIDC_CLIENT_ID=your-production-client-id
VITE_OIDC_AUTHORITY=https://your-identity-server.com

# Trakt.tv Integration (Optional)
VITE_TRAKT_API_KEY=your-trakt-api-key

# For Netlify Functions
TRAKT_API_KEY=your-trakt-api-key
```

## Netlify Deployment (Recommended)

Netlify is the recommended platform due to built-in Functions support for the Trakt proxy.

### 1. Prepare Repository

```bash
# Ensure your repository is pushed to GitHub
git push origin main
```

### 2. Connect to Netlify

1. Go to [Netlify](https://netlify.com)
2. Click "New site from Git"
3. Connect your GitHub repository
4. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `client/dist`
   - **Base directory**: Leave empty

### 3. Configure Environment Variables

In Netlify dashboard → Site settings → Environment variables:

```
VITE_SENSENET_REPO_URL=https://your-sensenet-repo.com
VITE_PROJECT_ROOT_PATH=/Root/Content
VITE_OIDC_CLIENT_ID=your-client-id
VITE_OIDC_AUTHORITY=https://your-identity-server.com
VITE_TRAKT_API_KEY=your-trakt-api-key
TRAKT_API_KEY=your-trakt-api-key
```

### 4. Deploy

Netlify will automatically build and deploy your site. The Trakt proxy function will be available at:
`https://your-site.netlify.app/.netlify/functions/trakt-proxy`

### 5. Custom Domain (Optional)

1. In Netlify dashboard → Domain management
2. Add your custom domain
3. Configure DNS records as instructed
4. Enable HTTPS (automatic with Let's Encrypt)

## Vercel Deployment

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Configure Project

Create `vercel.json` in project root:

```json
{
  "builds": [
    {
      "src": "client/package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/client/dist/$1"
    }
  ],
  "functions": {
    "client/netlify/functions/trakt-proxy.js": {
      "runtime": "nodejs18.x"
    }
  }
}
```

### 3. Deploy

```bash
# From project root
vercel --prod
```

Note: You'll need to adapt the Netlify function for Vercel's API routes format.

## Static Hosting (GitHub Pages, etc.)

For simple static hosting without serverless functions:

### 1. Build the Project

```bash
cd client
npm run build
```

### 2. Deploy Static Files

Upload the contents of `client/dist/` to your static hosting provider.

**Important**: Trakt integration will not work without the proxy function. You'll need to either:
- Disable Trakt features
- Use a different proxy solution
- Deploy the function separately

## Self-Hosted Deployment

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm install

COPY . .
RUN cd client && npm run build

FROM nginx:alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Create `nginx.conf`:

```nginx
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    server {
        listen 80;
        server_name localhost;
        root /usr/share/nginx/html;
        index index.html;

        # Handle client-side routing
        location / {
            try_files $uri $uri/ /index.html;
        }

        # API proxy (if using external proxy)
        location /api/ {
            proxy_pass https://your-api-server.com/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

Build and run:

```bash
docker build -t timeline-theories .
docker run -p 80:80 timeline-theories
```

### Traditional VPS/Server

1. **Install dependencies**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
   ```

2. **Clone and build**:
   ```bash
   git clone https://github.com/VargaJoe/timeline-theories.git
   cd timeline-theories
   npm install
   cd client
   npm install
   npm run build
   ```

3. **Configure Nginx**:
   ```bash
   sudo cp client/dist/* /var/www/html/
   # Configure nginx as shown above
   sudo systemctl restart nginx
   ```

## Post-Deployment Configuration

### 1. SenseNet Content Types

Ensure your SenseNet repository has the required content types installed:
- Timeline
- MediaItem  
- TimelineEntry

Import the XML definitions from `deployment/contenttypes/`.

### 2. OIDC Configuration

Update your OIDC provider with the production redirect URIs:
- Redirect URI: `https://your-domain.com/authentication/callback`
- Silent redirect URI: `https://your-domain.com/authentication/silent_callback`
- Post logout redirect URI: `https://your-domain.com/`

### 3. Content Structure

Create the initial folder structure in SenseNet:
```
/Root/Content/
├── Timelines/
└── MediaLibrary/
```

### 4. Testing

Test core functionality:
- User authentication
- Timeline creation
- Media item creation
- Trakt import (if enabled)
- Timeline entry management

## Monitoring and Maintenance

### Performance Monitoring

- Use Netlify Analytics or Google Analytics
- Monitor Core Web Vitals
- Set up error tracking (Sentry, LogRocket, etc.)

### Updates

To update the deployment:

```bash
# Pull latest changes
git pull origin main

# Rebuild (for manual deployments)
cd client
npm run build

# For Netlify/Vercel, just push to trigger rebuild
git push origin main
```

### Backup Strategy

- SenseNet data: Follow SenseNet backup procedures
- Configuration: Keep environment variables backed up securely
- Code: Ensure Git repository is properly backed up

## Troubleshooting

### Common Issues

1. **Authentication fails**: Check OIDC configuration and redirect URIs
2. **Trakt import not working**: Verify API key and function deployment
3. **SenseNet connection issues**: Check repository URL and permissions
4. **Build failures**: Verify Node.js version and dependencies

### Debug Mode

For production debugging, temporarily add:

```env
VITE_DEBUG=true
```

This enables additional console logging (remove for production).

### Support

- Check GitHub Issues for known problems
- Review SenseNet and Trakt API documentation
- Contact repository maintainers for assistance

---

For platform-specific deployment questions, refer to the respective platform documentation:
- [Netlify Docs](https://docs.netlify.com/)
- [Vercel Docs](https://vercel.com/docs)
- [SenseNet Documentation](https://docs.sensenet.com/)

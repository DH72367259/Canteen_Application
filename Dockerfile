FROM node:20-alpine

WORKDIR /app

# Copy built application
COPY .next/standalone ./
COPY public ./public
COPY .next/static ./.next/static

# Install dependencies
RUN npm install

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]

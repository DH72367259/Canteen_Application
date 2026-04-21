#!/bin/bash

# Firebase Deployment - Permission Fixed Version
# This handles npm permission issues on macOS

set -e

echo "=========================================="
echo "Firebase Deployment - Fix & Deploy"
echo "=========================================="
echo ""

cd ~/Canteen

# Step 1: Install Firebase CLI via Homebrew (better for macOS)
echo "Step 1: Installing Firebase CLI via Homebrew..."
if command -v firebase &> /dev/null; then
    echo "✓ Firebase CLI already installed"
else
    echo "Installing Firebase Tools..."
    brew install firebase-cli || npm install -g firebase-tools --unsafe-perm=true --allow-root
fi
echo ""

# Step 2: Verify installation
echo "Step 2: Verifying Firebase CLI..."
firebase --version
echo "✓ Firebase CLI verified"
echo ""

# Step 3: Install project dependencies
echo "Step 3: Installing project dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Step 4: Enable webframeworks
echo "Step 4: Enabling webframeworks experiment..."
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
echo "✓ Webframeworks enabled"
echo ""

# Step 5: Build application
echo "Step 5: Building Next.js application..."
npm run build
echo "✓ Build successful"
echo ""

# Step 6: Deploy to Firebase
echo "Step 6: Deploying to Firebase..."
npm run firebase:deploy:canteen:hosting
echo "✓ Deployment successful"
echo ""

echo "=========================================="
echo "✅ DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "Your app is live at:"
echo "🌐 https://canteen-dashboard-cfeb9.web.app"
echo ""

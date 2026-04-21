#!/bin/bash

# Firebase Deployment - Using sudo (works on any Mac)

set -e

echo "=========================================="
echo "Firebase Deployment - Sudo Method"
echo "=========================================="
echo ""

cd ~/Canteen

# Step 1: Install Firebase with sudo
echo "Step 1: Installing Firebase CLI..."
sudo npm install -g firebase-tools --unsafe-perm=true --allow-root
echo "✓ Firebase CLI installed"
echo ""

# Step 2: Verify installation
echo "Step 2: Verifying Firebase..."
firebase --version
echo "✓ Firebase verified"
echo ""

# Step 3: Install dependencies
echo "Step 3: Installing project dependencies..."
npm install
echo "✓ Dependencies installed"
echo ""

# Step 4: Enable webframeworks
echo "Step 4: Enabling webframeworks..."
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
echo "✓ Webframeworks enabled"
echo ""

# Step 5: Build
echo "Step 5: Building application..."
npm run build
echo "✓ Build complete"
echo ""

# Step 6: Deploy
echo "Step 6: Deploying to Firebase..."
npm run firebase:deploy:canteen:hosting
echo "✓ Deployment complete"
echo ""

echo "=========================================="
echo "✅ LIVE!"
echo "=========================================="
echo ""
echo "🌐 https://canteen-dashboard-cfeb9.web.app"
echo ""

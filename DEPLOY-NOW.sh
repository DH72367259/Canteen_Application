#!/bin/bash

# AUTONOMOUS DEPLOYMENT - From Copilot
# This runs automatically after code fixes

set -e

echo ""
echo "=========================================="
echo "   AUTONOMOUS DEPLOYMENT IN PROGRESS"
echo "=========================================="
echo ""

cd ~/Canteen

echo "Step 1: Building application..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✓ Build successful"
echo ""

echo "Step 2: Deploying to Firebase..."
npm run firebase:deploy:canteen:hosting
if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi
echo ""

echo "=========================================="
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "=========================================="
echo ""
echo "🌐 App is LIVE at:"
echo "   https://canteen-dashboard-cfeb9.web.app"
echo ""
echo "=========================================="
echo ""

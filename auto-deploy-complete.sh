#!/bin/bash

# COMPLETE AUTONOMOUS DEPLOYMENT
# Handles everything end-to-end

set -e

echo ""
echo "============================================"
echo "  CANTEEN APP - AUTONOMOUS DEPLOYMENT"
echo "============================================"
echo ""

cd ~/Canteen

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install Node.js first."
    exit 1
fi

# Check if firebase is available, install if not
if ! command -v firebase &> /dev/null; then
    echo "📦 Installing Firebase CLI..."
    sudo npm install -g firebase-tools --unsafe-perm=true --allow-root 2>/dev/null || npm install -g firebase-tools 2>/dev/null || true
fi

echo "Step 1: Installing dependencies..."
npm install --legacy-peer-deps 2>/dev/null || npm install 2>/dev/null
echo "✓ Dependencies installed"
echo ""

echo "Step 2: Enabling webframeworks..."
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9 2>/dev/null || true
echo "✓ Webframeworks enabled"
echo ""

echo "Step 3: Building application..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✓ Build successful"
echo ""

echo "Step 4: Deploying to Firebase..."
npm run firebase:deploy:canteen:hosting
if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi
echo ""

echo "============================================"
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "============================================"
echo ""
echo "🌐 Your app is LIVE at:"
echo ""
echo "   https://canteen-dashboard-cfeb9.web.app"
echo ""
echo "============================================"
echo ""
echo "Test Credentials:"
echo "  • Admin: admin@canteen.com / Admin@123456"
echo "  • User: user@test.com / Test@123456"
echo "  • Vendor: vendor@canteen.com / Vendor@123456"
echo "  • Worker: worker@canteen.com / Worker@123456"
echo ""

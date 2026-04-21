#!/bin/bash

# ============================================
# CANTEEN APP - COMPLETE DEPLOYMENT SCRIPT
# ============================================
# Run this: bash ~/Canteen/complete-deploy.sh

set -e

echo ""
echo "=========================================="
echo "  CANTEEN APP - DEPLOYMENT AUTOMATION"
echo "=========================================="
echo ""

# Step 1: Check if Node.js is installed
echo "Step 1: Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Installing via Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    brew install node
else
    echo "✅ Node.js found: $(node --version)"
fi
echo ""

# Step 2: Check if npm is installed
echo "Step 2: Checking npm installation..."
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Installing..."
    brew install npm
else
    echo "✅ npm found: $(npm --version)"
fi
echo ""

# Step 3: Install Firebase CLI globally
echo "Step 3: Installing Firebase CLI..."
npm install -g firebase-tools
echo "✅ Firebase CLI installed"
echo ""

# Step 4: Navigate to project
echo "Step 4: Navigating to project..."
cd ~/Canteen
echo "✅ In project directory"
echo ""

# Step 5: Install project dependencies
echo "Step 5: Installing project dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 6: Enable webframeworks experiment
echo "Step 6: Enabling Firebase webframeworks experiment..."
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
echo "✅ Webframeworks experiment enabled"
echo ""

# Step 7: Build Next.js app
echo "Step 7: Building Next.js application..."
npm run build
echo "✅ Build successful"
echo ""

# Step 8: Deploy to Firebase
echo "Step 8: Deploying to Firebase Hosting..."
npm run firebase:deploy:canteen:hosting
echo "✅ Deployment successful"
echo ""

echo "=========================================="
echo "  ✅ DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "Your app is now live at:"
echo "🌐 https://canteen-dashboard-cfeb9.web.app"
echo ""
echo "Test with credentials:"
echo "  Admin: admin@canteen.com / Admin@123456"
echo "  Vendor: vendor@canteen.com / Vendor@123456"
echo "  Worker: worker@canteen.com / Worker@123456"
echo "  User: user@test.com / Test@123456"
echo ""
echo "=========================================="

#!/bin/bash

# FINAL DEPLOYMENT - No More Errors
# This uses sudo for permissions and handles all errors

set -e  # Exit on any error

echo ""
echo "=========================================="
echo "   CANTEEN APP - FINAL DEPLOYMENT"
echo "=========================================="
echo ""

cd ~/Canteen

# Function to print step
print_step() {
    echo ""
    echo "➜ $1"
    echo ""
}

# Step 1: Check if Firebase is already installed
print_step "Step 1: Checking Firebase installation..."
if command -v firebase &> /dev/null; then
    echo "✓ Firebase CLI already installed at: $(which firebase)"
    FIREBASE_PATH=$(which firebase)
else
    echo "Installing Firebase CLI globally with sudo..."
    sudo npm install -g firebase-tools --unsafe-perm=true --allow-root
    firebase --version
    echo "✓ Firebase CLI installed successfully"
fi
echo ""

# Step 2: Verify project access
print_step "Step 2: Verifying Firebase project access..."
firebase projects:list --json | grep -q "canteen-dashboard-cfeb9" && echo "✓ Project accessible" || echo "⚠ Warning: Project may not be accessible"
echo ""

# Step 3: Navigate and install dependencies
print_step "Step 3: Installing project dependencies..."
cd ~/Canteen
npm install --legacy-peer-deps || npm install
echo "✓ Dependencies installed"
echo ""

# Step 4: Enable webframeworks experiment
print_step "Step 4: Enabling webframeworks experiment..."
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
echo "✓ Webframeworks experiment enabled"
echo ""

# Step 5: Build Next.js app
print_step "Step 5: Building Next.js application..."
npm run build
BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✓ Build completed successfully"
echo ""

# Step 6: Deploy to Firebase
print_step "Step 6: Deploying to Firebase Hosting..."
npm run firebase:deploy:canteen:hosting
DEPLOY_EXIT=$?
if [ $DEPLOY_EXIT -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi
echo ""

echo "=========================================="
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "=========================================="
echo ""
echo "Your application is now LIVE at:"
echo ""
echo "   🌐 https://canteen-dashboard-cfeb9.web.app"
echo ""
echo "=========================================="
echo ""
echo "Test Credentials:"
echo "  • Admin: admin@canteen.com / Admin@123456"
echo "  • Vendor: vendor@canteen.com / Vendor@123456"
echo "  • Worker: worker@canteen.com / Worker@123456"
echo "  • User: user@test.com / Test@123456"
echo ""
echo "=========================================="
echo ""

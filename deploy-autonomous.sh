#!/bin/bash

# AUTONOMOUS FINAL DEPLOYMENT - Execute build and deploy with error recovery

set -e

cd ~/Canteen

echo ""
echo "============================================"
echo "  AUTONOMOUS DEPLOYMENT - PHASE 2"
echo "============================================"
echo ""
echo "Timestamp: $(date)"
echo ""

# Step 1: Build
echo "Step 1: Building Next.js application..."
echo "Command: npm run build"
echo ""

npm run build 2>&1 | tee build.log

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo "✓ Build completed successfully"
else
    echo ""
    echo "❌ Build failed - check build.log for details"
    exit 1
fi

echo ""
echo "Step 2: Deploying to Firebase Hosting..."
echo "Command: npm run firebase:deploy:canteen:hosting"
echo ""

npm run firebase:deploy:canteen:hosting 2>&1 | tee deploy.log

if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo ""
    echo "============================================"
    echo "✅ DEPLOYMENT COMPLETE!"
    echo "============================================"
    echo ""
    echo "📱 App is LIVE at:"
    echo "   https://canteen-dashboard-cfeb9.web.app"
    echo ""
    echo "📊 GitHub Repository:"
    echo "   https://github.com/DH72367259/Canteen_Application"
    echo ""
    echo "🧪 Test Accounts:"
    echo "   Admin: admin@canteen.com / Admin@123456"
    echo "   Vendor: vendor@canteen.com / Vendor@123456"
    echo "   Worker: worker@canteen.com / Worker@123456"
    echo "   User: user@test.com / Test@123456"
    echo ""
    echo "✅ AUTONOMOUS SYSTEM ACTIVE"
    echo ""
    echo "Next: Test the live app, then tell me what feature to build."
    echo "I will handle all coding, commits, and deployments autonomously."
    echo ""
    echo "============================================"
else
    echo ""
    echo "❌ Deployment failed - check deploy.log for details"
    exit 1
fi

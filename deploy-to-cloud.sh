#!/bin/bash
# Automated Deploy to Cloud - Choose Your Platform

set -e

PROJECT_NAME="Canteen Management Application"
BUILD_SUCCESS=false

echo ""
echo "🚀 $PROJECT_NAME - Cloud Deployment Script"
echo "==========================================="
echo ""

# Step 1: Build
echo "📦 Building application..."
npm run build

if [ $? -eq 0 ]; then
  BUILD_SUCCESS=true
  echo "✅ Build successful!"
  echo ""
fi

if [ "$BUILD_SUCCESS" = false ]; then
  echo "❌ Build failed"
  exit 1
fi

echo ""
echo "🌐 Choose deployment platform:"
echo ""
echo "1. Vercel (Recommended for Next.js)"
echo "2. Railway"
echo "3. Firebase Hosting"
echo ""
echo -n "Enter choice (1-3): "
read CHOICE

case $CHOICE in
  1)
    echo ""
    echo "📤 Deploying to Vercel..."
    echo "Note: You may need to authenticate. Follow the browser prompts."
    echo ""
    vercel --prod
    echo ""
    echo "✅ Deployed to Vercel!"
    echo "🌐 Your app is now live on the web"
    ;;
  2)
    echo ""
    echo "📤 Deploying to Railway..."
    echo "Linking to Railway project..."
    railway project link
    echo ""
    echo "Uploading and deploying..."
    railway up
    echo ""
    echo "✅ Deployed to Railway!"
    echo "🌐 Your app is now live on the web"
    ;;
  3)
    echo ""
    echo "📤 Deploying to Firebase Hosting..."
    echo "Note: Make sure you're logged in to Firebase"
    echo ""
    firebase deploy --only hosting:canteenApp
    echo ""
    echo "✅ Deployed to Firebase!"
    echo "🌐 Visit: https://canteen-dashboard-cfeb9.web.app"
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

echo ""
echo "=========================================="
echo "✅ Application deployed successfully!"
echo "=========================================="
echo ""
echo "Test Credentials:"
echo "  Admin:     admin@canteen.com / Admin@123456"
echo "  Vendor:    vendor@canteen.com / Vendor@123456"
echo "  Worker:    worker@canteen.com / Worker@123456"
echo "  User:      user@test.com / Test@123456"
echo "  SuperAdmin: superadmin@canteen.com / SuperAdmin@123456"
echo ""

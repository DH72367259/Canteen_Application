#!/bin/bash
# Firebase Deploy Script - Clean and Simple

set -e

PROJECT_ID="canteen-dashboard-cfeb9"
FIREBASE_URL="https://canteen-dashboard-cfeb9.web.app"

echo "🔨 Building application..."
npm run build

echo "🚀 Deploying to Firebase..."
firebase deploy --project $PROJECT_ID --only hosting

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Application URL: $FIREBASE_URL"
echo ""
echo "🔐 Test Credentials:"
echo "   Admin:     admin@canteen.com / Admin@123456"
echo "   Vendor:    vendor@canteen.com / Vendor@123456"
echo "   Worker:    worker@canteen.com / Worker@123456"
echo "   User:      user@test.com / Test@123456"
echo "   SuperAdmin: superadmin@canteen.com / SuperAdmin@123456"
echo ""

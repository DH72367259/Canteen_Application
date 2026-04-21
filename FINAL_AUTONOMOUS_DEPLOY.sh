#!/bin/bash

# FINAL AUTONOMOUS DEPLOYMENT SCRIPT
# Canteen Application -> Firebase Hosting
# Status: Ready for Production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  CANTEEN APP - FINAL DEPLOYMENT${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

PROJECT_ID="canteen-dashboard-cfeb9"
FIREBASE_URL="https://canteen-dashboard-cfeb9.web.app"

# Step 1: Clean build cache
echo -e "${YELLOW}Step 1: Clearing old build artifacts...${NC}"
rm -rf .next .firebase build.log deploy.log 2>/dev/null || true
echo -e "${GREEN}✓ Cache cleared${NC}"
echo ""

# Step 2: Build Next.js
echo -e "${YELLOW}Step 2: Building Next.js application...${NC}"
npm run build 2>&1 | tee build.log
BUILD_STATUS=${PIPESTATUS[0]}

if [ $BUILD_STATUS -ne 0 ]; then
  echo -e "${RED}✗ Build failed${NC}"
  echo -e "${RED}Check build.log for details${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Build completed successfully${NC}"
echo ""

# Step 3: Check Firebase authentication
echo -e "${YELLOW}Step 3: Checking Firebase authentication...${NC}"
if ! firebase projects:list --project=$PROJECT_ID >/dev/null 2>&1; then
  echo -e "${RED}✗ Not authenticated with Firebase${NC}"
  echo ""
  echo -e "${YELLOW}ACTION REQUIRED:${NC}"
  echo -e "${YELLOW}Run the following command to login:${NC}"
  echo ""
  echo -e "${BLUE}  firebase login${NC}"
  echo ""
  echo -e "${YELLOW}Then run this script again.${NC}"
  echo ""
  exit 1
fi

echo -e "${GREEN}✓ Firebase authentication valid${NC}"
echo ""

# Step 4: Deploy to Firebase
echo -e "${YELLOW}Step 4: Deploying to Firebase Hosting...${NC}"
firebase deploy --project $PROJECT_ID --only hosting 2>&1 | tee deploy.log
DEPLOY_STATUS=${PIPESTATUS[0]}

if [ $DEPLOY_STATUS -ne 0 ]; then
  echo -e "${RED}✗ Deployment failed${NC}"
  echo -e "${RED}Check deploy.log for details${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  DEPLOYMENT SUCCESSFUL! ✓${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Your application is now live at:${NC}"
echo -e "${GREEN}  ${FIREBASE_URL}${NC}"
echo ""
echo -e "${BLUE}Test Credentials:${NC}"
echo -e "  Admin:      admin@canteen.com / Admin@123456"
echo -e "  Vendor:     vendor@canteen.com / Vendor@123456"
echo -e "  Worker:     worker@canteen.com / Worker@123456"
echo -e "  User:       user@test.com / Test@123456"
echo -e "  SuperAdmin: superadmin@canteen.com / SuperAdmin@123456"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Open ${FIREBASE_URL} in your browser"
echo -e "  2. Login with any test credentials above"
echo -e "  3. Try creating orders, managing bins, etc."
echo ""

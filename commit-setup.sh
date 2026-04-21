#!/bin/bash

# Final commit of setup files before deployment
cd ~/Canteen

# Add new setup files
git add auto-deploy-complete.sh COMPLETE_AUTONOMOUS_SYSTEM.md DEPLOYMENT_STATUS_NOW.md DEPLOY-NOW.sh 2>/dev/null || true

# Commit
git commit -m "chore: add autonomous deployment scripts and setup documentation" 2>/dev/null || true

# Push to GitHub
git push origin main 2>/dev/null || true

echo "Setup files committed and pushed to GitHub"

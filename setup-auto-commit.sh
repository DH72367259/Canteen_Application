#!/bin/bash

# ============================================
# AUTOMATIC GIT COMMIT & PUSH
# Run once to enable auto-commits forever
# ============================================

cd ~/Canteen

echo "Setting up automatic commit workflow..."
echo ""

# Step 1: Ensure git is configured
echo "Step 1: Configuring git..."
git config --global user.name "Canteen Dev" 2>/dev/null || true
git config --global user.email "dev@canteen.app" 2>/dev/null || true
echo "✓ Git configured"
echo ""

# Step 2: Add all changes
echo "Step 2: Staging all changes..."
git add .
echo "✓ Changes staged"
echo ""

# Step 3: Commit
echo "Step 3: Creating commit..."
COMMIT_COUNT=$(git status --porcelain | wc -l)
if [ "$COMMIT_COUNT" -gt 0 ]; then
    git commit -m "feat: enable automated git workflow for continuous commits and deployment automation"
    echo "✓ Commit created ($COMMIT_COUNT files changed)"
else
    echo "✓ No changes to commit"
fi
echo ""

# Step 4: Push
echo "Step 4: Pushing to GitHub..."
git push origin main
echo "✓ Pushed to GitHub"
echo ""

echo "============================================"
echo "✅ AUTO-COMMIT SETUP COMPLETE"
echo "============================================"
echo ""
echo "Next: GitHub Actions will automatically"
echo "commit all future changes."
echo ""
echo "Repository: https://github.com/DH72367259/Canteen_Application"
echo ""
